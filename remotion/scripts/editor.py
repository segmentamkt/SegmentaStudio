"""Editor semántico de Kiko: revisar tomas → planificar (con libreto) → revisar el plan → vista previa → render.

Desde la carpeta remotion/:
    python3 scripts/editor.py revisar --clip ~/Downloads/TOMA.MOV
    python3 scripts/editor.py planificar --clip TOMA1.MOV TOMA2.MOV --libreto libreto.docx [--recursos recursos.json]
    python3 scripts/editor.py planificar --guion "Texto para probar con voz guía"
    python3 scripts/editor.py editar --plan trabajo/toma/plan_edicion.json --cambios cambios.json
    python3 scripts/editor.py rehacer --plan trabajo/toma/plan_edicion.json   # tras editar el JSON a mano
    python3 scripts/editor.py render --plan trabajo/toma/plan_edicion.json [--vista-previa auto] [--marca marca.json]

«planificar» transcribe palabra por palabra, alinea con el libreto (si lo hay), detecta entidades, consulta la
IA si está disponible y escribe plan_edicion.json + plan_edicion.md. Con --skills (skills.json de Kiko Studio)
cada skill ajusta su parte y el Director recomienda cuáles usar según la toma y el --objetivo. No renderiza nada: el render solo corre
cuando tú lo pides, sobre el plan que revisaste.

Kiko Studio llama a estos mismos pasos con --sin-descargas y lee las líneas «@@progreso» y «@@revision».
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import unicodedata
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import director  # noqa: E402
import ia  # noqa: E402
import libreto  # noqa: E402
import skills as habilidades  # noqa: E402
import sfx  # noqa: E402
from audio import PUBLICO, TRABAJO, cadena_voz, ejecutar, ffmpeg, medir_loudness, normalizar, preparar_musica, voz_guia  # noqa: E402
import montaje  # noqa: E402
from planificador import (  # noqa: E402
    Candidato, Palabra, buscar_escritura, buscar_frase, candidatos_locales, clave_recurso, codigo_pais, construir_plan,
    eventos_de_libreto, icono_svg, momento_de_contestar, ocurrencias, resumen_markdown,
)
from qc import qc  # noqa: E402
from subtitulos import tarjetas_subtitulos  # noqa: E402
from texto import normalizar_palabra  # noqa: E402

FPS = 30
SALIDA = RAIZ / "out"
ENTREGA = Path.home() / "Downloads" / "kiko_ediciones"
DICCIONARIO = RAIZ / "diccionario.json"
DURACION_VISTA_PREVIA = 12.0
# Claves del plan que no dependen de los tiempos y deben sobrevivir a «rehacer».
_PERSISTENTES = ("libreto", "recursos", "musica", "sugerencias_montaje", "descartados_base", "palabras_fuente",
                 "skills", "director", "objetivo", "eventos_skill", "zoom_frases", "zoom_quitados")
MOTIVO_SKILL = "skill «Efectos visuales»"  # descartes por la skill: vuelven si cambias la skill
MOTIVO_ZOOM = {"gancho": "Gancho", "remate": "Remate"}  # acercamientos automáticos que se pueden quitar


def _progreso(porcentaje: int, etapa: str, mensaje: str) -> None:
    """Línea que Kiko Studio convierte en la barra de progreso del panel."""
    print(f"@@progreso {porcentaje}|{etapa}|{mensaje}", flush=True)


def _nombre(texto: str) -> str:
    base = "".join(c for c in unicodedata.normalize("NFD", texto.lower()) if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", base).strip("-")[:40] or "edicion"


def _correcciones_diccionario(palabras: list[Palabra]) -> list[dict]:
    if not DICCIONARIO.exists():
        return []
    diccionario = {normalizar_palabra(k): v for k, v in json.loads(DICCIONARIO.read_text(encoding="utf-8")).items()}
    correcciones = []
    for p in palabras:
        if p.norm in diccionario:
            original = re.sub(r"[,.;:!?…]+$", "", p.texto)
            if diccionario[p.norm] != original:
                correcciones.append({"i": p.i, "de": p.texto, "a": diccionario[p.norm] + p.texto[len(original):],
                                     "fuente": "diccionario", "motivo": "diccionario.json"})
    return correcciones


def _aplicar(palabras: list[Palabra], correcciones: list[dict]) -> None:
    for correccion in correcciones:
        palabras[correccion["i"]].texto = correccion["a"]


def leer_libreto(ruta: Path) -> str:
    """.txt/.md directo; .docx, .doc, .rtf y .odt con textutil de macOS (sin instalar nada)."""
    if ruta.suffix.lower() in {".docx", ".doc", ".rtf", ".odt", ".html"}:
        return ejecutar("textutil", "-convert", "txt", "-stdout", str(ruta)).stdout
    return ruta.read_text(encoding="utf-8")


def _cargar_recursos(ruta: Path | None, nombre: str) -> dict[str, dict]:
    """recursos.json: [{"nombre", "tipo": image|logo|sound|music, "ruta", "licencia"}] → copiados a public/recursos/."""
    if not ruta:
        return {}
    recursos = {}
    for numero, recurso in enumerate(json.loads(ruta.read_text(encoding="utf-8"))):
        if copiado := _recurso_publico(recurso, nombre, numero):
            recursos[clave_recurso(recurso["nombre"])] = copiado
    return recursos


def _recurso_publico(recurso: dict, nombre: str, numero: int) -> dict | None:
    """Copia un recurso de tu biblioteca a public/recursos/<plan>/ para que Remotion lo use."""
    origen = Path(recurso["ruta"])
    if not origen.is_file():
        return None
    destino = PUBLICO / "recursos" / nombre
    destino.mkdir(parents=True, exist_ok=True)
    archivo = f"{clave_recurso(recurso['nombre']) or 'recurso'}-{numero}{origen.suffix.lower()}"
    shutil.copy2(origen, destino / archivo)
    return {"nombre": recurso["nombre"], "tipo": recurso["tipo"], "archivo": f"recursos/{nombre}/{archivo}",
            "licencia": recurso.get("licencia", "")}


# --- Revisar una toma antes de planificar -------------------------------------------------------

def revisar(args: argparse.Namespace) -> None:
    """Revisa formato, audio y silencio inicial de una toma; imprime «@@revision {json}»."""
    from kiko_studio.editorial_analysis import inspect_media

    clip = args.clip[0].expanduser().resolve()
    datos = inspect_media(clip)
    ancho, alto = (datos.width, datos.height) if datos.rotation_degrees % 180 == 0 else (datos.height, datos.width)
    revision = []

    def anotar(clave: str, nivel: str, mensaje: str) -> None:
        revision.append({"id": clave, "nivel": nivel, "mensaje": mensaje})

    if alto > ancho:
        anotar("orientacion", "ok", f"Vertical {ancho}×{alto}.")
    else:
        anotar("orientacion", "aviso", f"La toma es horizontal ({ancho}×{alto}): se recortará a 9:16 y puede cortar tu cara.")
    corto = min(ancho, alto)
    anotar("resolucion", "ok" if corto >= 1080 else "aviso",
           f"Resolución {corto}p." if corto >= 1080 else f"Resolución {corto}p: se verá suave; graba en 1080p o más.")
    if datos.nominal_fps:
        anotar("fps", "ok" if 24 <= datos.nominal_fps <= 60 else "aviso", f"{datos.nominal_fps:g} fotogramas por segundo.")
    anotar("duracion", "ok" if datos.duration_seconds <= 180 else "aviso",
           f"Dura {datos.duration_seconds:.0f} s." + ("" if datos.duration_seconds <= 180 else " Para reels conviene menos de 3 minutos."))
    if not datos.has_audio:
        anotar("audio", "error", "La toma no tiene audio: no se puede transcribir ni alinear con el libreto.")
    else:
        medido = medir_loudness(clip)
        volumen, pico = float(medido["input_i"]), float(medido["input_tp"])
        if volumen < -32:
            anotar("audio", "aviso", f"Voz muy baja ({volumen:.0f} LUFS): acércate al micrófono.")
        elif pico > -0.5:
            anotar("audio", "aviso", f"El audio satura (pico {pico:.1f} dBTP): baja la ganancia del micrófono.")
        else:
            anotar("audio", "ok", f"Volumen de voz correcto ({volumen:.0f} LUFS).")
        silencios = ffmpeg("-t", "3", "-i", str(clip), "-vn", "-af", "silencedetect=noise=-38dB:d=0.4", "-f", "null", "-").stderr
        inicio_silencio = re.search(r"silence_start: (-?[\d.]+)", silencios)
        if inicio_silencio and float(inicio_silencio.group(1)) <= 0.1:
            anotar("silencio_inicial", "ok", "Empieza con una pausa: el corte inicial será limpio.")
        else:
            anotar("silencio_inicial", "aviso", "Empiezas a hablar enseguida: deja 1 s de silencio antes de la primera palabra.")
    print("@@revision " + json.dumps({"clip": str(clip), "revision": revision}, ensure_ascii=False), flush=True)


# --- Planificar -------------------------------------------------------------------------------

def planificar(args: argparse.Namespace) -> None:
    from kiko_studio.editorial_analysis import _transcribe_speech_analyzer, transcribe_local

    palabras: list[Palabra] = []
    transcripciones = []
    if args.clip:
        clips = [c.expanduser().resolve() for c in args.clip]
        nombre = args.nombre or _nombre(clips[0].stem)
        for k, clip in enumerate(clips):
            _progreso(5 + int(30 * k / len(clips)), "transcribing",
                      f"Escuchando la toma {k + 1} de {len(clips)} palabra por palabra…")
            transcripcion = transcribe_local(clip, locale=args.locale)
            transcripciones.append(asdict(transcripcion))
            for w in (w for s in transcripcion.segments for w in s.words):
                palabras.append(Palabra(len(palabras), w.text, round(w.start, 3), round(w.end, 3), k))
        fuente = {"tipo": "clip", "originales": [str(c) for c in clips], "original": str(clips[0]),
                  "inicio_clip": 0.0, "locale": args.locale}
    else:
        nombre = args.nombre or "guion-" + _nombre(" ".join(args.guion.split()[:4]))
        (TRABAJO / nombre).mkdir(parents=True, exist_ok=True)
        _progreso(8, "transcribing", "Escuchando la voz guía palabra por palabra…")
        wav = voz_guia(args.guion, TRABAJO / nombre / "voz_guia.wav")
        transcripcion = _transcribe_speech_analyzer(wav, args.locale)
        transcripciones.append(asdict(transcripcion))
        palabras = [Palabra(i, w.text, round(w.start, 3), round(w.end, 3)) for i, w in
                    enumerate(w for s in transcripcion.segments for w in s.words)]
        fuente = {"tipo": "voz_guia", "original": None, "audio": str(wav), "guion": args.guion,
                  "inicio_clip": 0.0, "locale": args.locale}
    carpeta = TRABAJO / nombre
    carpeta.mkdir(parents=True, exist_ok=True)
    (carpeta / "transcripcion.json").write_text(json.dumps(transcripciones, ensure_ascii=False, indent=1))
    if not palabras:
        raise SystemExit("La transcripción no trae marcas por palabra; no se inventan tiempos.")

    recursos = _cargar_recursos(args.recursos, nombre)
    skills = habilidades.cargar(args.skills)
    objetivo = " ".join((args.objetivo or "").split())[:600]
    texto_libreto = leer_libreto(args.libreto.expanduser()) if args.libreto else None
    alineacion, indicados, avisos, sin_grafico, correcciones = None, [], [], [], []
    if texto_libreto is not None:
        _progreso(38, "analyzing", "Comparando lo que dijiste con el libreto…")
        lineas = libreto.leer(texto_libreto)
        if not lineas:
            raise SystemExit("El libreto está vacío: pega o sube el texto que vas a decir.")
        alineacion = libreto.alinear(lineas, palabras)
        if alineacion["cobertura"] < 0.4:
            avisos.append(f"Solo el {alineacion['cobertura']:.0%} del libreto coincide con la toma: ¿es el libreto de este video?")
        correcciones = alineacion["correcciones"]
        _aplicar(palabras, correcciones)
    corregidas = {c["i"] for c in correcciones}
    diccionario = [c for c in _correcciones_diccionario(palabras) if c["i"] not in corregidas]
    _aplicar(palabras, diccionario)
    correcciones += diccionario

    _progreso(45, "analyzing", "Buscando lugares, objetos, cifras y repeticiones…")
    candidatos = candidatos_locales(palabras)
    if alineacion:
        indicados, avisos_indicaciones, sin_grafico = eventos_de_libreto(alineacion, palabras, recursos)
        avisos += avisos_indicaciones
    for numero, c in enumerate(candidatos):
        c.id = f"c{numero}"
    hechos, seccion_director = None, None
    dirigir = bool(skills) and habilidades.activa(skills, "director")
    preferido = args.ia
    if dirigir:
        _progreso(50, "analyzing", "El Director mide la imagen y el audio de la toma…")
        segmentos_previos = alineacion["segmentos"] if alineacion and alineacion["segmentos"] else [[0, len(palabras) - 1]]
        util = sum(palabras[b].fin - palabras[a].inicio for a, b in segmentos_previos)
        hechos = director.analizar(clips if args.clip else [], palabras=palabras, duracion_util=util,
                                   alineacion=alineacion, candidatos=candidatos)
        seccion_director = director.seccion_prompt(objetivo, hechos, skills)
        if preferido == "auto":
            preferido = habilidades.ajuste(skills, "director", "proveedor", "auto")
    if args.ia != "no":
        _progreso(55, "planning", "El Director revisa el plan y tu objetivo (sesión autorizada, sin claves API)…"
                  if dirigir else "La IA revisa el plan (sesión autorizada, sin claves API)…")
    nuevos, descartes, correcciones_ia, rechazos, info_ia = ia.proponer(
        palabras, candidatos, preferido if args.ia != "no" else "no", libreto=texto_libreto, director=seccion_director)
    respuesta_director = info_ia.pop("director", None)
    plan_director = None
    if dirigir:
        recomendaciones = []
        if isinstance(respuesta_director, dict):
            recomendaciones = director.validar(respuesta_director.get("recomendaciones"), skills,
                                               fuente=f"ia:{info_ia.get('proveedor', 'ia')}")
        fuente_director = f"ia:{info_ia.get('proveedor')}" if recomendaciones else "local"
        if not recomendaciones:
            recomendaciones = director.recomendaciones_locales(hechos, skills, objetivo)
            respuesta_director = {}
        plan_director = {
            "objetivo": objetivo, "fuente": fuente_director, "hechos": hechos, "recomendaciones": recomendaciones,
            "objetivo_entendido": " ".join(str(respuesta_director.get("objetivo") or "").split())[:300],
            "resumen": " ".join(str(respuesta_director.get("resumen") or "").split())[:600]
                       or "Recomendación local a partir de lo medido: " + ", ".join(hechos["observaciones"][:5]) + ".",
            "aplicadas": [],
        }
    descartados_ia = []
    for candidato, motivo in descartes:
        candidatos.remove(candidato)
        descartados_ia.append({"componente": candidato.componente, "ancla": " ".join(p.texto for p in palabras[candidato.i0:candidato.i1 + 1]),
                               "inicio": palabras[candidato.i0].inicio, "fuente": info_ia.get("proveedor", "ia"), "motivo": f"La IA lo descartó: {motivo}"})
    vistos = {(c.componente, c.i0) for c in candidatos}
    candidatos += [c for c in nuevos if (c.componente, c.i0) not in vistos]
    # Con libreto, la escritura correcta ya está dada: no se aceptan correcciones adivinadas.
    nuevas = [] if alineacion else [c for c in correcciones_ia if c["i"] not in {x["i"] for x in correcciones}]
    _aplicar(palabras, nuevas)
    correcciones += nuevas
    if nuevas:
        for c in candidatos:
            if c.componente in {"texto_cinetico", "trofeo"}:
                c.params.pop("texto", None)
    # [SIN GRÁFICO] apaga lo automático en esa línea; las indicaciones explícitas se suman al final.
    candidatos = [c for c in candidatos if not any(a <= c.i0 <= b for a, b in sin_grafico)]
    for numero, c in enumerate(indicados):
        c.id = f"l{numero}"
    candidatos += indicados

    plan = construir_plan(palabras, candidatos, fuente, ia=info_ia, correcciones=correcciones,
                          descartes_ia=descartados_ia + rechazos)
    segmentos, eleccion = _segmentos(palabras, alineacion, skills)
    musica = next((r for r in recursos.values() if r["tipo"] == "music"), None)
    plan.update({
        "palabras_fuente": plan["palabras"],
        "montaje": {"segmentos": segmentos, "tramos": [], "eliminados": [], "eleccion": eleccion},
        "descartados_base": descartados_ia + rechazos,
        "sugerencias_montaje": None if alineacion else montaje.detectar_repeticiones(palabras),
        "libreto": ({"texto": texto_libreto, "cobertura": alineacion["cobertura"], "lineas": alineacion["lineas"],
                     "faltan": alineacion["faltan"], "fuera_del_libreto": alineacion["fuera_del_libreto"], "avisos": avisos}
                    if alineacion else None),
        "recursos": list(recursos.values()),
        "musica": {"activada": True, "nivel": "-30 LUFS bajo la voz, +10 dB sin voz",
                   "recurso": musica["archivo"] if musica else None, "nombre": musica["nombre"] if musica else "Apple Loops"},
        "skills": skills, "director": plan_director, "objetivo": objetivo, "eventos_skill": [],
    })
    ruta = carpeta / "plan_edicion.json"
    ruta.write_text(json.dumps(plan, ensure_ascii=False, indent=1))
    _progreso(85, "planning", "Armando el montaje y los tiempos…")
    _rehacer(ruta, copiar=not args.sin_descargas)
    _progreso(100, "complete", "Plan listo para revisar. Nada se ha renderizado.")


def _segmentos(palabras: list[Palabra], alineacion: dict | None, skills: dict) -> tuple[list[list[int]], str | None]:
    """Montaje inicial: las líneas del libreto (o las tomas completas si «Recortes» está apagada), sin
    muletillas si la skill lo pide."""
    if alineacion and alineacion["segmentos"] and habilidades.activa(skills, "recortes"):
        segmentos, eleccion = [list(s) for s in alineacion["segmentos"]], "libreto"
    else:
        segmentos, eleccion = [], ("original" if alineacion else None)
        for p in palabras:
            if segmentos and palabras[segmentos[-1][1]].clip == p.clip:
                segmentos[-1][1] = p.i
            else:
                segmentos.append([p.i, p.i])
    if habilidades.activa(skills, "recortes") and habilidades.ajuste(skills, "recortes", "muletillas", False):
        segmentos, _ = montaje.sin_muletillas(palabras, segmentos)
    return segmentos, eleccion


def _aire(skills: dict) -> dict:
    return {"aire": habilidades.ajuste(skills, "recortes", "aire", montaje.AIRE),
            "aire_inicial": habilidades.ajuste(skills, "recortes", "aire_inicial", montaje.AIRE_INICIAL),
            "cola_final": habilidades.ajuste(skills, "recortes", "cola_final", montaje.COLA_FINAL)}


def _efectos(skills: dict) -> dict:
    """Lo que la skill «Efectos visuales» permite al elegir gráficos (sin skills: todo, como siempre)."""
    if not skills:
        return {}
    componentes = set(habilidades.ajuste(skills, "efectos", "componentes", [])) if habilidades.activa(skills, "efectos") else set()
    return {"componentes": componentes, "densidad": habilidades.ajuste(skills, "efectos", "densidad", "alta"),
            "margen": habilidades.ajuste(skills, "efectos", "separacion", 0.25)}


# --- Rehacer / editar ---------------------------------------------------------------------------

# Parámetros que dependen del tiempo: se recalculan siempre después de un montaje.
_PARAMS_DE_TIEMPO = {"resalta", "zoom_inicio", "zoom_fin", "texto_en", "pulsaciones", "vibracion", "contesta",
                     "aterriza", "svg", "etiqueta", "atenuar_desde", "sobre_mapa", "escritura_i"}


def _palabras_fuente(plan: dict) -> list[Palabra]:
    return [Palabra(w["i"], w["texto"], w["inicio"], w["fin"], w.get("clip", 0)) for w in plan["palabras_fuente"]]


def rehacer(args: argparse.Namespace) -> None:
    """Recalcula el plan tras editarlo a mano: montaje (tramos), eventos borrados o agregados."""
    _rehacer(args.plan.expanduser().resolve(), copiar=not args.sin_descargas)


def _rehacer(ruta: Path, *, copiar: bool) -> None:
    plan = json.loads(ruta.read_text(encoding="utf-8"))
    skills = plan.get("skills") or {}
    fuente_palabras = _palabras_fuente(plan)
    segmentos = plan["montaje"]["segmentos"]
    tramos, duracion = montaje.tramos_de(fuente_palabras, segmentos, **_aire(skills))
    salida, origen = montaje.aplicar(fuente_palabras, tramos)
    destino: dict[int, int] = {}
    for indice_salida, indice_fuente in origen.items():
        destino.setdefault(indice_fuente, indice_salida)

    candidatos, cortados = [], []
    # Los gráficos que una skill dejó fuera vuelven a competir: si cambiaste la skill, pueden entrar.
    todos = plan["eventos"] + [e for e in plan.get("eventos_skill", []) if e["id"] not in {x["id"] for x in plan["eventos"]}]
    for numero, evento in enumerate(todos):
        ancla = evento.get("ancla_fuente") or evento["ancla"]
        i0, i1 = destino.get(ancla["i0"]), destino.get(ancla["i1"])
        texto_fuente = " ".join(p.texto for p in fuente_palabras[ancla["i0"]:ancla["i1"] + 1])
        if i0 is None or i1 is None or i1 - i0 != ancla["i1"] - ancla["i0"]:
            cortados.append({"componente": evento["componente"], "ancla": texto_fuente, "inicio": fuente_palabras[ancla["i0"]].inicio,
                             "fuente": evento.get("fuente", "usuario"), "motivo": "Sus palabras quedaron fuera del montaje."})
            continue
        params = {k: v for k, v in evento.get("params", {}).items() if k not in _PARAMS_DE_TIEMPO}
        if evento["componente"] == "teclado":
            escritura = buscar_escritura(salida, i0)
            params["escritura_i"] = escritura.i if escritura else None
        elif evento["componente"] == "llamada":
            params["contesta"] = momento_de_contestar(salida, i0)
        elif evento["componente"] == "moneda":
            params["aterriza"] = salida[i1].fin
        clave = evento.get("clave") or f"{evento['componente']}:{params.get('pais') or params.get('icono') or normalizar_palabra(texto_fuente)}"
        candidatos.append(Candidato(
            evento["componente"], i0, i1, params, evento.get("justificacion", "Agregado a mano."),
            fuente=evento.get("fuente", "usuario"), verificar=evento.get("verificar"), clave=clave,
            id=evento.get("id") or f"u{numero}",
        ))

    nuevo = construir_plan(salida, candidatos, plan["fuente"], ia=plan["ia"], correcciones=plan["correcciones"],
                           descartes_ia=plan.get("descartados_base", []) + cortados, duracion=duracion, origen=origen,
                           efectos=_efectos(skills))
    cortes = []
    if habilidades.activa(skills, "edicion") and habilidades.ajuste(skills, "edicion", "zoom_cortes", True):
        escala = 1 + habilidades.ajuste(skills, "edicion", "intensidad_zoom", 6) / 100
        cortes = montaje.zoom_de_cortes(tramos, duracion, escala)
    quitados = tuple(MOTIVO_ZOOM[z] for z in plan.get("zoom_quitados", []))
    zoom = sorted([z for z in nuevo["camara"]["zoom"] if not z["motivo"].startswith(quitados)] + cortes,
                  key=lambda z: z["inicio"])
    nuevo["camara"]["zoom"] = sorted(zoom + _zoom_pedidos(plan, salida, destino, duracion, zoom), key=lambda z: z["inicio"])
    for clave in _PERSISTENTES:
        if clave in plan:
            nuevo[clave] = plan[clave]
    por_skill = {d.get("id") for d in nuevo["descartados"] if MOTIVO_SKILL in d["motivo"]}
    nuevo["eventos_skill"] = [e for e in todos if e["id"] in por_skill]
    nuevo["montaje"] = {"segmentos": segmentos, "tramos": tramos, "eliminados": montaje.eliminados(fuente_palabras, segmentos),
                        "eleccion": plan["montaje"].get("eleccion")}
    _guardar(nuevo, ruta, copiar=copiar)


def _zoom_pedidos(plan: dict, salida: list[Palabra], destino: dict[int, int], duracion: float, zoom: list[dict]) -> list[dict]:
    """Acercamientos pedidos en una frase («Edición y ritmo»): parten del encuadre que había en ese momento."""
    pedidos = []
    for pedido in plan.get("zoom_frases", []):
        i0, i1 = destino.get(pedido["i0"]), destino.get(pedido["i1"])
        if i0 is None or i1 is None:
            continue  # la frase quedó fuera del montaje
        inicio = round(max(0.0, salida[i0].inicio - 0.05), 3)
        vigente = next((z for z in reversed(zoom) if z["inicio"] <= inicio < z["hasta"]), None)
        pedidos.append({"inicio": inicio, "fin": round(inicio + 0.25, 3), "de": vigente["a"] if vigente else 1.0,
                        "a": pedido["escala"], "hasta": round(min(duracion, salida[i1].fin + 0.6), 3),
                        "motivo": f"Acercamiento pedido en «{pedido['texto']}»", "id": pedido["id"]})
    return pedidos


def _en_video(fuente_palabras: list[Palabra], segmentos: list[list[int]]) -> list[Palabra]:
    return [fuente_palabras[i] for a, b in segmentos for i in range(a, b + 1)]


def _frase_en_video(fuente_palabras: list[Palabra], segmentos: list[list[int]], frase: str) -> tuple[int, int]:
    """Índices (de la toma original) de una frase tal como suena en el video final."""
    rango = buscar_frase(_en_video(fuente_palabras, segmentos), str(frase))
    if rango is None:
        raise SystemExit(f"No encuentro «{frase}» en el video; escríbela tal como suena.")
    largo = len([t for t in (normalizar_palabra(x) for x in str(frase).split()) if t])
    if rango[1] - rango[0] != largo - 1:
        raise SystemExit(f"«{frase}» queda partida por un corte del montaje; usa una parte más corta.")
    return rango


def _nuevo_id(eventos: list[dict], prefijo: str) -> str:
    usados = [int(m.group(1)) for e in eventos if (m := re.fullmatch(rf"{prefijo}(\d+)", str(e["id"])))]
    return f"{prefijo}{max(usados, default=0) + 1}"


def _corregir(plan: dict, fuente_palabras: list[Palabra], correccion: dict) -> None:
    """Corrige una palabra mal transcrita en la toma original: cambia subtítulos y lo que sale de lo dicho."""
    dice, correcta = str(correccion.get("dice", "")).split(), str(correccion.get("correcta", "")).split()
    if not dice or not correcta:
        raise SystemExit("Para corregir, indica la palabra como sale y cómo se escribe.")
    if len(dice) > 1 and len(dice) != len(correcta):
        raise SystemExit("Para corregir varias palabras, escribe la corrección con el mismo número de palabras.")
    rangos = ocurrencias(fuente_palabras, " ".join(dice))
    usadas = {i for a, b in plan["montaje"]["segmentos"] for i in range(a, b + 1)}
    rangos = [r for r in rangos if r[0] in usadas] or rangos
    if not rangos:
        raise SystemExit(f"No encuentro «{' '.join(dice)}» en lo que dijiste.")
    textos = correcta if len(dice) > 1 else [" ".join(correcta)]
    for desde, _ in rangos if correccion.get("todas", True) else rangos[:1]:
        for k, texto in enumerate(textos):
            palabra = plan["palabras_fuente"][desde + k]
            nucleo = re.sub(r"^[¿¡«\"(]+|[,.;:!?…»\")]+$", "", palabra["texto"])
            inicio = palabra["texto"].index(nucleo) if nucleo else 0
            nuevo = palabra["texto"][:inicio] + re.sub(r"^[¿¡«\"(]+|[,.;:!?…»\")]+$", "", texto) + palabra["texto"][inicio + len(nucleo):]
            plan["correcciones"].append({"i": desde + k, "de": palabra["texto"], "a": nuevo, "fuente": "usuario",
                                         "motivo": "Corregida en la revisión."})
            palabra["texto"] = fuente_palabras[desde + k].texto = nuevo


def _evento_pedido(plan: dict, fuente_palabras: list[Palabra], pedido: dict) -> dict:
    """Un gráfico, imagen o sonido que pides en una frase dicha; lo pedido siempre se respeta al elegir."""
    componente = pedido.get("componente")
    i0, i1 = _frase_en_video(fuente_palabras, plan["montaje"]["segmentos"], pedido.get("frase", ""))
    dicho = re.sub(r"[,.;:…]+$", "", " ".join(p.texto for p in fuente_palabras[i0:i1 + 1]))
    if componente == "texto_cinetico":
        texto = re.sub(r"[,.;:…]+$", "", " ".join(str(pedido.get("texto") or dicho).split())).upper()[:90]
        params = {"texto": texto, "estilo": "cifra" if re.fullmatch(r"[\d.,%$ ]+", texto) else "concepto"}
    elif componente == "icono":
        nombre = str(pedido.get("icono", "")).strip().lower()
        if not icono_svg(nombre):
            raise SystemExit(f"El ícono «{pedido.get('icono')}» no existe en Tabler (tabler.io/icons).")
        params = {"icono": nombre, **({"sin_etiqueta": True} if pedido.get("sin_etiqueta") else {})}
    elif componente == "mapa_pais":
        pais = codigo_pais(str(pedido.get("pais", "")))
        if not pais:
            raise SystemExit(f"No reconozco el país «{pedido.get('pais')}».")
        params = {"pais": pais[0], "nombre": pais[1]}
    elif componente == "imagen":
        recurso = next((r for r in plan.get("recursos", []) if r["tipo"] in {"image", "logo"}
                        and clave_recurso(r["nombre"]) == clave_recurso(str(pedido.get("recurso", "")))), None)
        if not recurso:
            raise SystemExit(f"La imagen «{pedido.get('recurso')}» no está en los recursos de este video.")
        params = {"recurso": recurso["nombre"], "archivo": recurso["archivo"]}
    elif componente == "sonido":
        if pedido.get("sonido") not in SONIDOS_SFX:
            raise SystemExit(f"No hay un sonido «{pedido.get('sonido')}»; usa {', '.join(SONIDOS_SFX)}.")
        params, i1 = {"recurso": pedido["sonido"], "archivo": f"audio/sfx/{pedido['sonido']}.wav"}, i0
    else:
        raise SystemExit(f"No sé agregar «{componente}».")
    return {"id": _nuevo_id(plan["eventos"] + plan.get("eventos_skill", []), "u"), "componente": componente,
            "ancla_fuente": {"i0": i0, "i1": i1}, "ancla": {"i0": i0, "i1": i1}, "params": params,
            "justificacion": str(pedido.get("motivo") or "Agregado en la revisión.")[:300], "fuente": "usuario",
            "verificar": None}


def editar(args: argparse.Namespace) -> None:
    """Aplica los cambios de la revisión (panel de Kiko Studio, chat de una skill o a mano) y recalcula el plan.

    cambios.json: {"quitar": [ids], "textos": {id: texto}, "agregar_textos": [frase dicha],
                   "ajustes": {id: {"ajuste_inicio": s, "duracion": s}}, "iconos": {id: ícono}, "sin_sonido": [ids],
                   "agregar_eventos": [{"componente": texto_cinetico|icono|mapa_pais|imagen|sonido, "frase",
                                        "texto"|"icono"|"pais"|"recurso"|"sonido"}],
                   "recursos_nuevos": [{"nombre", "tipo", "ruta", "licencia"}],
                   "montaje": "libreto" | "usar_ultima" | "quitar_repeticion" | "original" | [[desde, hasta], …],
                   "quitar_frases": [frase], "recuperar_frases": [frase],
                   "zoom_frases": [{"frase", "intensidad"}], "quitar_zoom": ["gancho" | "remate" | id],
                   "corregir": [{"dice", "correcta", "todas"}]}
    """
    ruta = args.plan.expanduser().resolve()
    plan = json.loads(ruta.read_text(encoding="utf-8"))
    cambios = json.loads(args.cambios.read_text(encoding="utf-8"))
    fuente_palabras = _palabras_fuente(plan)

    # Skills de esta edición: la configuración actual de la plataforma o las recomendaciones aceptadas.
    recortes_antes = (habilidades.activa(plan.get("skills") or {}, "recortes"),
                      habilidades.ajuste(plan.get("skills") or {}, "recortes", "muletillas", False))
    try:
        if "skills_base" in cambios:
            plan["skills"] = habilidades.cargar_dict(cambios["skills_base"])
        if "skills" in cambios:
            plan["skills"] = habilidades.aplicar(plan.get("skills") or {}, cambios["skills"])
    except ValueError as exc:
        raise SystemExit(str(exc)) from None
    if "recomendaciones_aplicadas" in cambios and plan.get("director"):
        plan["director"]["aplicadas"] = sorted(set(plan["director"].get("aplicadas", [])) | set(cambios["recomendaciones_aplicadas"]))
    skills = plan.get("skills") or {}
    if (habilidades.activa(skills, "recortes"), habilidades.ajuste(skills, "recortes", "muletillas", False)) != recortes_antes \
            and "montaje" not in cambios:
        alineacion = libreto.alinear(libreto.leer(plan["libreto"]["texto"]), fuente_palabras) if plan.get("libreto") else None
        plan["montaje"]["segmentos"], plan["montaje"]["eleccion"] = _segmentos(fuente_palabras, alineacion, skills)

    # Montaje primero: lo que se agrega después se busca en el video tal como queda.
    eleccion = cambios.get("montaje")
    if eleccion == "original":
        segmentos = []
        for p in fuente_palabras:
            if segmentos and fuente_palabras[segmentos[-1][1]].clip == p.clip:
                segmentos[-1][1] = p.i
            else:
                segmentos.append([p.i, p.i])
        plan["montaje"]["segmentos"] = segmentos
    elif eleccion == "libreto":
        if not plan.get("libreto"):
            raise SystemExit("Este plan no tiene libreto.")
        lineas = libreto.leer(plan["libreto"]["texto"])
        plan["montaje"]["segmentos"] = libreto.alinear(lineas, fuente_palabras)["segmentos"]
        if habilidades.activa(skills, "recortes") and habilidades.ajuste(skills, "recortes", "muletillas", False):
            plan["montaje"]["segmentos"], _ = montaje.sin_muletillas(fuente_palabras, plan["montaje"]["segmentos"])
    elif isinstance(eleccion, str):
        opciones = (plan.get("sugerencias_montaje") or {}).get("opciones", {})
        if eleccion not in opciones:
            raise SystemExit(f"No hay una sugerencia de montaje «{eleccion}» en este plan.")
        plan["montaje"]["segmentos"] = opciones[eleccion]["segmentos"]
    elif eleccion is not None:
        segmentos = [[int(a), int(b)] for a, b in eleccion]
        if not segmentos or any(not 0 <= a <= b < len(fuente_palabras) for a, b in segmentos):
            raise SystemExit("Los cortes del montaje no son válidos: cada tramo debe ir de una palabra a otra de la toma.")
        plan["montaje"]["segmentos"] = segmentos
    if eleccion is not None:
        plan["montaje"]["eleccion"] = eleccion if isinstance(eleccion, str) else "manual"
    for frase in cambios.get("quitar_frases", []):
        plan["montaje"]["segmentos"] = montaje.quitar_rango(
            plan["montaje"]["segmentos"], *_frase_en_video(fuente_palabras, plan["montaje"]["segmentos"], frase))
        plan["montaje"]["eleccion"] = "manual"
    if not plan["montaje"]["segmentos"]:
        raise SystemExit("El video no puede quedar vacío.")
    for frase in cambios.get("recuperar_frases", []):
        usadas = {i for a, b in plan["montaje"]["segmentos"] for i in range(a, b + 1)}
        candidatas = ocurrencias(fuente_palabras, str(frase))
        rango = next((r for r in candidatas if any(i not in usadas for i in range(r[0], r[1] + 1))), None)
        if rango is None:
            raise SystemExit(f"«{frase}» ya está en el video." if candidatas
                             else f"No encuentro «{frase}» en tus tomas; escríbela tal como suena.")
        plan["montaje"]["segmentos"] = montaje.agregar_rango(fuente_palabras, plan["montaje"]["segmentos"], *rango)
        plan["montaje"]["eleccion"] = "manual"

    for correccion in cambios.get("corregir", []):
        _corregir(plan, fuente_palabras, correccion)

    ids = {e["id"] for e in plan["eventos"]}
    pedidos = set(cambios.get("quitar", [])) | set(cambios.get("textos", {})) | set(cambios.get("ajustes", {})) \
        | set(cambios.get("iconos", {})) | set(cambios.get("sin_sonido", []))
    if desconocidos := sorted(map(str, pedidos - ids)):
        raise SystemExit(f"No hay un gráfico «{desconocidos[0]}» en este plan; vuelve a abrirlo.")
    quitar = set(cambios.get("quitar", []))
    for evento in plan["eventos"]:
        if evento["id"] in quitar:
            plan.setdefault("descartados_base", []).append({
                "componente": evento["componente"], "ancla": evento["ancla"]["texto"], "inicio": evento["inicio"],
                "fuente": "usuario", "motivo": "Quitado en la revisión."})
    plan["eventos"] = [e for e in plan["eventos"] if e["id"] not in quitar]

    for evento in plan["eventos"]:
        texto = cambios.get("textos", {}).get(evento["id"])
        if texto is not None and evento["componente"] in {"texto_cinetico", "trofeo"}:
            if not str(texto).strip():
                raise SystemExit(f"El texto de «{evento['ancla']['texto']}» no puede quedar vacío.")
            evento["params"]["texto"] = str(texto).strip()[:90].upper()
        for clave, (minimo, maximo) in {"ajuste_inicio": (-3.0, 3.0), "duracion": (0.5, 8.0)}.items():
            valor = cambios.get("ajustes", {}).get(evento["id"], {}).get(clave, "sin cambio")
            if valor == "sin cambio":
                continue
            if valor in (None, "", 0):
                evento["params"].pop(clave, None)  # vuelve al tiempo automático
            else:
                evento["params"][clave] = round(max(minimo, min(maximo, float(valor))), 2)
        icono = cambios.get("iconos", {}).get(evento["id"])
        if icono is not None:
            nombre = str(icono).strip().lower()
            if evento["componente"] != "icono" or not icono_svg(nombre):
                raise SystemExit(f"No puedo poner el ícono «{icono}» en «{evento['ancla']['texto']}»: "
                                 + ("ese gráfico no es un ícono." if evento["componente"] != "icono" else "no existe en Tabler."))
            evento["params"]["icono"], evento["clave"] = nombre, f"icono:{nombre}"
        if evento["id"] in cambios.get("sin_sonido", []):
            evento["params"]["sin_sonido"] = True

    for numero, recurso in enumerate(cambios.get("recursos_nuevos", []), len(plan.get("recursos", []))):
        if any(clave_recurso(r["nombre"]) == clave_recurso(recurso["nombre"]) for r in plan.get("recursos", [])):
            continue
        copiado = _recurso_publico(recurso, ruta.parent.name, numero)
        if not copiado:
            raise SystemExit(f"No encuentro el archivo de «{recurso['nombre']}» en tu biblioteca.")
        plan.setdefault("recursos", []).append(copiado)

    for frase in cambios.get("agregar_textos", []):
        rango = buscar_frase(fuente_palabras, frase)
        if rango is None:
            raise SystemExit(f"No encuentro «{frase}» en lo que dijiste; escríbela tal como suena en la toma.")
        i0, i1 = rango
        dicho = " ".join(p.texto for p in fuente_palabras[i0:i1 + 1])
        plan["eventos"].append({
            "id": _nuevo_id(plan["eventos"] + plan.get("eventos_skill", []), "u"),
            "componente": "texto_cinetico", "ancla_fuente": {"i0": i0, "i1": i1}, "ancla": {"i0": i0, "i1": i1},
            "params": {"texto": re.sub(r"[,.;:…]+$", "", dicho).upper(), "estilo": "concepto"},
            "justificacion": "Agregado en la revisión.", "fuente": "usuario", "verificar": None,
        })
    for pedido in cambios.get("agregar_eventos", []):
        plan["eventos"].append(_evento_pedido(plan, fuente_palabras, pedido))

    for pedido in cambios.get("zoom_frases", []):
        i0, i1 = _frase_en_video(fuente_palabras, plan["montaje"]["segmentos"], pedido.get("frase", ""))
        intensidad = max(2.0, min(20.0, float(pedido.get("intensidad") or 10)))
        plan.setdefault("zoom_frases", []).append({
            "id": _nuevo_id(plan["zoom_frases"], "z"), "i0": i0, "i1": i1, "escala": round(1 + intensidad / 100, 3),
            "texto": re.sub(r"[,.;:…]+$", "", " ".join(p.texto for p in fuente_palabras[i0:i1 + 1]))})
    for cual in cambios.get("quitar_zoom", []):
        if cual in MOTIVO_ZOOM:
            plan["zoom_quitados"] = sorted(set(plan.get("zoom_quitados", [])) | {cual})
        elif any(z["id"] == cual for z in plan.get("zoom_frases", [])):
            plan["zoom_frases"] = [z for z in plan["zoom_frases"] if z["id"] != cual]
        else:
            raise SystemExit(f"No hay un acercamiento «{cual}» que quitar.")

    ruta.write_text(json.dumps(plan, ensure_ascii=False, indent=1))
    _rehacer(ruta, copiar=not args.sin_descargas)

def _guardar(plan: dict, ruta: Path, *, copiar: bool = True) -> None:
    nombre = ruta.parent.name
    ruta.write_text(json.dumps(plan, ensure_ascii=False, indent=1))
    resumen = resumen_markdown(plan, nombre)
    (ruta.parent / "plan_edicion.md").write_text(resumen)
    if not copiar:
        print(f"Plan: {ruta}")
        return
    entrega = ENTREGA / nombre
    entrega.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ruta, entrega / ruta.name)
    (entrega / "plan_edicion.md").write_text(resumen)
    print(resumen)
    print(f"Plan: {ruta}\nCopia para revisar: {entrega / 'plan_edicion.md'}")


# --- Render -------------------------------------------------------------------------------------

# --- Estilo de las skills en el render ----------------------------------------------------------

NEUTRO = {"brightness": 1.0, "contrast": 1.0, "saturate": 1.0, "sepia": 0.0, "grayscale": 0.0, "hue-rotate": 0.0}
FILTROS = {  # cada filtro al 100 %; la intensidad de la skill lo acerca a NEUTRO
    "calido": {"sepia": 0.3, "saturate": 1.15, "hue-rotate": -10, "brightness": 1.03},
    "frio": {"saturate": 0.95, "hue-rotate": 12, "brightness": 1.02, "contrast": 1.05},
    "cine": {"contrast": 1.18, "saturate": 0.82, "brightness": 0.97, "sepia": 0.12},
    "vivo": {"saturate": 1.4, "contrast": 1.08},
    "vintage": {"sepia": 0.5, "contrast": 0.92, "saturate": 0.8, "brightness": 1.05},
    "bn": {"grayscale": 1.0, "contrast": 1.15},
}
POSICION_SUBTITULOS = {"alta": 1920 * 0.64, "media": 1920 * 0.72, "baja": 1920 * 0.79}
RESALTADOS = {"blanco": "#FFFFFF", "verde": "#4ADE80", "cian": "#22D3EE", "rosa": "#F472B6", "naranja": "#FB923C"}
SONIDOS_SFX = ("whoosh", "pop", "impacto", "ovacion", "clic", "vibracion", "ping")


def filtro_css(skills: dict) -> str:
    """Filtros de color y brillo/contraste de «Retoques» como un filtro CSS para la cámara."""
    valores = dict(NEUTRO)
    if habilidades.activa(skills, "filtros"):
        k = habilidades.ajuste(skills, "filtros", "intensidad", 60) / 100
        for nombre, objetivo in FILTROS.get(habilidades.ajuste(skills, "filtros", "preset", "natural"), {}).items():
            valores[nombre] = NEUTRO[nombre] + (objetivo - NEUTRO[nombre]) * k
    if habilidades.activa(skills, "retoques"):
        valores["brightness"] *= 1 + habilidades.ajuste(skills, "retoques", "brillo", 0) / 100
        valores["contrast"] *= 1 + habilidades.ajuste(skills, "retoques", "contraste", 0) / 100
    return " ".join(f"{nombre}({valor:.3f}{'deg' if nombre == 'hue-rotate' else ''})"
                    for nombre, valor in valores.items() if abs(valor - NEUTRO[nombre]) > 1e-3)


def _copiar_recurso(recurso: dict, nombre: str) -> str:
    """Copia un recurso de una skill a public/ y devuelve la ruta que usa Remotion."""
    destino = PUBLICO / "recursos" / nombre / "skills" / f"{recurso['id'][:8]}{Path(recurso['ruta']).suffix.lower()}"
    destino.parent.mkdir(parents=True, exist_ok=True)
    if not destino.exists():
        shutil.copy2(recurso["ruta"], destino)
    return f"recursos/{nombre}/skills/{destino.name}"


def _estilo(skills: dict, nombre: str) -> dict:
    activa = lambda skill: habilidades.activa(skills, skill)  # noqa: E731
    valor = lambda skill, clave, defecto: habilidades.ajuste(skills, skill, clave, defecto)  # noqa: E731
    fuente = habilidades.recurso(skills, "subtitulos", "fuente") if activa("subtitulos") else None
    marco = habilidades.recurso(skills, "superposiciones", "marco") if activa("superposiciones") else None
    rotulo = valor("superposiciones", "rotulo", "") if activa("superposiciones") else ""
    retoques = activa("retoques")
    return {
        "camara": {
            "filtro": filtro_css(skills),
            "nitidez": valor("retoques", "nitidez", 0) / 100 if retoques else 0,
            "suavizado": valor("retoques", "suavizado", 0) / 100 if retoques else 0,
            "vineta": valor("retoques", "vineta", 0) / 100 if retoques else 0,
            "zoom_lento": bool(activa("edicion") and valor("edicion", "zoom_lento", False)),
        },
        "subtitulos": {
            "activos": activa("subtitulos"),
            "centro_completo": round(POSICION_SUBTITULOS[valor("subtitulos", "posicion", "media")], 1),
            "escala": valor("subtitulos", "tamano", 100) / 100,
            "resaltado": RESALTADOS.get(valor("subtitulos", "resaltado", "marca")),
            "fuente": {"archivo": _copiar_recurso(fuente, nombre), "familia": "KikoFuentePropia"} if fuente else None,
        },
        "superposiciones": {
            "activas": activa("superposiciones"),
            "marca_posicion": valor("superposiciones", "posicion_marca", "derecha"),
            "marca_opacidad": valor("superposiciones", "opacidad_marca", 80) / 100,
            "rotulo": {"texto": rotulo, "hasta": valor("superposiciones", "segundos_rotulo", 4)} if rotulo else None,
            "marco": _copiar_recurso(marco, nombre) if marco else None,
        },
        "audio": {"sfx_volumen": valor("audio_fx", "volumen", 100) / 100},
    }


def _sonidos(plan: dict, nombre: str) -> list[dict]:
    """Los efectos de audio de cada gráfico, con los tuyos donde la skill «Efectos de audio» los asigna."""
    skills = plan.get("skills") or {}
    if not habilidades.activa(skills, "audio_fx"):
        return []
    propios = {f"audio/sfx/{clave}.wav": _copiar_recurso(r, nombre) for clave in SONIDOS_SFX
               if (r := habilidades.recurso(skills, "audio_fx", clave))}
    return [{**s, "archivo": propios.get(s["archivo"], s["archivo"])} for e in plan["eventos"] for s in e["sonidos"]]


def _timeline(plan: dict, fuentes: list[dict], musica: dict | None, marca: dict | None = None,
              nombre: str | None = None) -> dict:
    # Las correcciones ya vienen aplicadas desde la planificación (y sus índices son de la toma original).
    skills = plan.get("skills") or {}
    palabras = [dict(p) for p in plan["palabras"]]
    visuales = [e for e in plan["eventos"] if e["componente"] != "sonido"]
    # Solo las anclas cortas son palabras clave: una imagen pedida para toda una línea no la pinta de amarillo.
    cortas = [e for e in visuales if e["ancla"]["i1"] - e["ancla"]["i0"] < 5]
    claves = {i for e in cortas for i in range(e["ancla"]["i0"], e["ancla"]["i1"] + 1)}
    finales = {e["ancla"]["i1"] for e in cortas}
    ventanas = []
    for evento in sorted(visuales, key=lambda e: e["inicio"]):
        if ventanas and evento["inicio"] - ventanas[-1][1] < 0.6:
            ventanas[-1][1] = max(ventanas[-1][1], evento["fin"])
        else:
            ventanas.append([evento["inicio"], evento["fin"]])
    voces = []
    for p in palabras:
        if voces and p["inicio"] - voces[-1][1] < 0.3:
            voces[-1][1] = p["fin"]
        else:
            voces.append([p["inicio"], p["fin"]])
    duracion_voz = plan["duracion"]
    cierre = (marca or {}).get("cierre") or {}
    duracion = round(duracion_voz + (float(cierre.get("duracion", 2.5)) if cierre.get("texto") else 0), 3)
    return {
        "version": 3, "fps": FPS, "ancho": 1080, "alto": 1920, "duracion": duracion, "duracion_voz": duracion_voz,
        "fuente": {"tipo": plan["fuente"]["tipo"], "clips": fuentes, "clip": fuentes[0]["clip"], "voz": fuentes[0]["voz"],
                   "inicio_clip": plan["fuente"].get("inicio_clip", 0.0)},
        "tramos": [{"desde": t["desde"], "hasta": t["hasta"], "salida": t["salida"], "clip": t.get("clip", 0)}
                   for t in plan.get("montaje", {}).get("tramos", [])],
        "palabras": palabras,
        "subtitulos": tarjetas_subtitulos(palabras, duracion_voz, claves, finales,
                                          mayusculas=habilidades.ajuste(skills, "subtitulos", "mayusculas", True)),
        "layout": {"dividido": [[round(a, 3), round(b, 3)] for a, b in ventanas]},
        "camara": plan["camara"],
        "eventos": plan["eventos"],
        "sonidos": _sonidos(plan, nombre) if nombre else [s for e in plan["eventos"] for s in e["sonidos"]],
        "musica": ({**musica, "ventanas_voz": [[round(a, 3), round(b, 3)] for a, b in voces],
                    "fade_out": [round(duracion - 0.6, 3), duracion]} if musica else None),
        "marca": marca,
        "estilo": _estilo(skills, nombre) if nombre else None,
    }


def _marca(ruta: Path | None, nombre: str) -> dict | None:
    """marca.json: {"colores": {"morado", "violeta", "amarillo"}, "logo": ruta, "marca_de_agua": bool,
    "cierre": {"texto", "duracion"}} → logo copiado a public/recursos/<plan>/."""
    if not ruta:
        return None
    marca = json.loads(ruta.read_text(encoding="utf-8"))
    logo = marca.get("logo")
    if logo and Path(logo).is_file():
        destino = PUBLICO / "recursos" / nombre / f"logo{Path(logo).suffix.lower()}"
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(logo, destino)
        marca["logo"] = f"recursos/{nombre}/{destino.name}"
    else:
        marca["logo"] = None
    return marca


def _ventana_vista_previa(plan: dict, inicio: str) -> float:
    """«auto»: los 12 s con más gráficos y cortes; si no, el segundo pedido."""
    if inicio != "auto":
        return max(0.0, min(float(inicio), plan["duracion"] - DURACION_VISTA_PREVIA))
    marcas = [e["inicio"] for e in plan["eventos"]] + [t["salida"] for t in plan["montaje"].get("tramos", [])[1:]]
    candidatos = [0.0] + [max(0.0, m - 1.5) for m in marcas]
    mejor = max(candidatos, key=lambda a: (sum(a <= m < a + DURACION_VISTA_PREVIA for m in marcas), -a))
    return round(min(mejor, max(0.0, plan["duracion"] - DURACION_VISTA_PREVIA)), 2)


def render(args: argparse.Namespace) -> None:
    ruta_plan = args.plan.expanduser().resolve()
    plan = json.loads(ruta_plan.read_text(encoding="utf-8"))
    nombre = ruta_plan.parent.name
    fuente = plan["fuente"]
    originales = [Path(p) for p in (fuente.get("originales") or [fuente["original"] or fuente["audio"]])]
    skills = plan.get("skills") or {}
    con_sonido = habilidades.activa(skills, "sonido")
    limpieza = con_sonido and habilidades.ajuste(skills, "sonido", "limpieza", True)
    fuentes, voces = [], []
    for k, origen in enumerate(originales):
        _progreso(4 + int(12 * k / len(originales)), "audio",
                  f"Limpiando la voz de la toma {k + 1}: aislamiento, ecualización y compresión…" if limpieza
                  else f"Preparando la voz de la toma {k + 1} (sin limpieza)…")
        voz = cadena_voz(origen, f"{nombre}-{k}" if len(originales) > 1 else nombre, limpieza=limpieza,
                         aislamiento=habilidades.ajuste(skills, "sonido", "aislamiento", 65))
        voces.append(voz)
        clip = None
        if fuente["tipo"] == "clip":
            destino = PUBLICO / "clips" / f"{nombre}-{k}{origen.suffix.lower()}"
            destino.parent.mkdir(parents=True, exist_ok=True)
            if not destino.exists() or destino.stat().st_size != origen.stat().st_size:
                shutil.copy2(origen, destino)
            clip = f"clips/{destino.name}"
        fuentes.append({"clip": clip, "voz": voz["archivo"]})
    _progreso(18, "assets", "Preparando efectos de sonido y música…")
    sfx.generar(PUBLICO / "audio" / "sfx")
    musica = None
    if (plan.get("musica", {}).get("activada") and not args.sin_musica and con_sonido
            and habilidades.ajuste(skills, "sonido", "musica", True)):
        # La música del proyecto manda; si no hay, la pista elegida en la skill «Sonido»; si no, Apple Loops.
        propia, pista = plan["musica"].get("recurso"), habilidades.recurso(skills, "sonido", "pista")
        nivel = habilidades.ajuste(skills, "sonido", "nivel_musica", -30)
        musica = (preparar_musica(PUBLICO / propia, nombre, nivel) if propia
                  else preparar_musica(Path(pista["ruta"]), nombre, nivel) if pista else preparar_musica(nivel=nivel))
    timeline = _timeline(plan, fuentes, musica, _marca(args.marca, nombre), nombre)
    props = TRABAJO / nombre / "timeline.json"
    props.write_text(json.dumps({"timeline": timeline}, ensure_ascii=False))
    SALIDA.mkdir(exist_ok=True)

    if args.vista_previa:
        # Prueba corta a media resolución: sirve para revisar ritmo, gráficos y sonido antes del render largo.
        inicio = _ventana_vista_previa(plan, args.vista_previa)
        desde, hasta = round(inicio * FPS), min(round((inicio + DURACION_VISTA_PREVIA) * FPS), round(timeline["duracion"] * FPS) - 1)
        crudo, vista = SALIDA / f"{nombre}_vista_crudo.mp4", SALIDA / f"{nombre}_vista.mp4"
        _progreso(24, "rendering", f"Vista previa de {inicio:.1f} a {inicio + DURACION_VISTA_PREVIA:.1f} s…")
        _render_remotion(crudo, props, extra=[f"--frames={desde}-{hasta}", "--scale=0.5"])
        normalizar(crudo, vista, video=True)
        (TRABAJO / nombre / "vista.json").write_text(json.dumps({"inicio": inicio, "duracion": (hasta - desde + 1) / FPS}))
        print(f"Vista previa: {vista}")
        _progreso(100, "complete", "Vista previa lista.")
        return

    crudo, final = SALIDA / f"{nombre}_crudo.mp4", SALIDA / f"{nombre}.mp4"
    _progreso(24, "rendering", "Renderizando el video vertical…")
    _render_remotion(crudo, props)
    _progreso(88, "verifying", "Normalizando el volumen a -14 LUFS…")
    normalizar(crudo, final, video=True)
    _progreso(93, "verifying", "Control de calidad: imagen, audio, sincronía y rostro…")
    informe = qc(final, timeline, voces[0] if len(voces) == 1 else {"tomas": voces})
    _progreso(97, "verifying", "Exportando subtítulos y miniatura…")
    _exportar_srt(timeline, SALIDA / f"{nombre}.srt")
    _miniatura(final, timeline, SALIDA / f"{nombre}.jpg")

    plan["estado"].update({"aprobado": True, "implementado": True, "validado": all(informe["aprobado"].values()),
                           "renderizado_en": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    ruta_plan.write_text(json.dumps(plan, ensure_ascii=False, indent=1))
    (TRABAJO / nombre / "qc.json").write_text(json.dumps(informe, ensure_ascii=False, indent=1))
    print(json.dumps(informe["aprobado"], ensure_ascii=False))
    _progreso(100, "complete", "Video renderizado y verificado.")
    if args.sin_descargas:
        print(f"Video: {final}")
        return
    entrega = ENTREGA / nombre
    entrega.mkdir(parents=True, exist_ok=True)
    for archivo in (final, SALIDA / f"{nombre}.srt", SALIDA / f"{nombre}.jpg", ruta_plan):
        shutil.copy2(archivo, entrega / archivo.name)
    (entrega / "qc.json").write_text(json.dumps(informe, ensure_ascii=False, indent=1))
    print(f"Video: {entrega / final.name}")


def _tiempo_srt(segundos: float) -> str:
    milis = int(round(segundos * 1000))
    return f"{milis // 3_600_000:02d}:{milis // 60_000 % 60:02d}:{milis // 1000 % 60:02d},{milis % 1000:03d}"


def _exportar_srt(timeline: dict, destino: Path) -> None:
    """Las mismas tarjetas del video, para subirlas como subtítulos editables en las redes.

    En el video las tarjetas se funden unas décimas; en el SRT cada una termina donde empieza la siguiente,
    porque algunos reproductores muestran dos subtítulos a la vez si se solapan.
    """
    tarjetas = timeline["subtitulos"]
    bloques = []
    for n, t in enumerate(tarjetas, 1):
        fin = min(t["fin"], tarjetas[n]["inicio"]) if n < len(tarjetas) else t["fin"]
        bloques.append(f"{n}\n{_tiempo_srt(t['inicio'])} --> {_tiempo_srt(fin)}\n{' '.join(p['texto'] for p in t['palabras'])}\n")
    destino.write_text("\n".join(bloques), encoding="utf-8")


def _miniatura(video: Path, timeline: dict, destino: Path) -> None:
    """Fotograma del primer gráfico fuerte (texto grande o mapa) o, si no hay, del segundo 1."""
    fuerte = next((e for e in timeline["eventos"] if e["componente"] in {"texto_cinetico", "mapa_pais", "imagen", "trofeo"}), None)
    momento = (fuerte["inicio"] + 0.6) if fuerte else 1.0
    ffmpeg("-y", "-ss", f"{momento:.2f}", "-i", str(video), "-frames:v", "1", "-q:v", "2", str(destino))


def _render_remotion(destino: Path, props: Path, extra: list[str] | None = None) -> None:
    """Remotion imprime «Rendered X/Y» por fotograma; se traduce a progreso entre 24 % y 86 %."""
    proceso = subprocess.Popen(
        ["npx", "remotion", "render", "src/index.ts", "EdicionSemantica", str(destino), f"--props={props}",
         "--codec", "h264", "--crf", "18", "--audio-codec", "aac", *(extra or [])],
        cwd=RAIZ, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    ultimas, anterior = [], -1
    with proceso:
        for linea in proceso.stdout:
            ultimas = (ultimas + [linea.rstrip()])[-40:]
            hecho = re.search(r"Rendered (\d+)/(\d+)", linea)
            if hecho:
                porcentaje = 24 + int(62 * int(hecho.group(1)) / max(1, int(hecho.group(2))))
                if porcentaje != anterior:
                    _progreso(porcentaje, "rendering", f"Renderizando fotograma {hecho.group(1)} de {hecho.group(2)}…")
                    anterior = porcentaje
    if proceso.returncode != 0:
        raise SystemExit("Falló el render de Remotion:\n" + "\n".join(ultimas[-15:]))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    pasos = parser.add_subparsers(dest="paso", required=True)
    v = pasos.add_parser("revisar", help="Revisa una toma (formato, audio, silencio inicial) antes de planificar.")
    v.add_argument("--clip", type=Path, nargs=1, required=True)
    p = pasos.add_parser("planificar", help="Transcribe, alinea con el libreto y propone el plan; no renderiza.")
    origen = p.add_mutually_exclusive_group(required=True)
    origen.add_argument("--clip", type=Path, nargs="+", help="Tus grabaciones (MOV/MP4/M4V), en orden.")
    origen.add_argument("--guion", help="Texto para probar con la voz guía de macOS.")
    p.add_argument("--libreto", type=Path, help="Lo que vas a decir (.txt, .md, .docx, .rtf); corrige y ordena las tomas.")
    p.add_argument("--recursos", type=Path, help="recursos.json con tus imágenes, logos, sonidos y música.")
    p.add_argument("--nombre", help="Nombre de la carpeta del proyecto.")
    p.add_argument("--locale", default="es-CO")
    p.add_argument("--ia", default="auto", choices=["auto", "claude", "codex", "gemini", "no"],
                   help="Pase semántico con IA (sesión autorizada, sin claves API). «no» deja solo el análisis local.")
    p.add_argument("--skills", type=Path, help="skills.json de Kiko Studio: ajustes de cada skill y el Director.")
    p.add_argument("--objetivo", help="Qué quieres lograr con este video: el Director recomienda skills según esto.")
    h = pasos.add_parser("rehacer", help="Recalcula el plan tras editarlo (montaje, eventos borrados o agregados); no renderiza.")
    h.add_argument("--plan", type=Path, required=True)
    e = pasos.add_parser("editar", help="Aplica cambios de revisión (cambios.json) y recalcula el plan; no renderiza.")
    e.add_argument("--plan", type=Path, required=True)
    e.add_argument("--cambios", type=Path, required=True)
    r = pasos.add_parser("render", help="Ejecuta un plan revisado.")
    r.add_argument("--plan", type=Path, required=True)
    r.add_argument("--sin-musica", action="store_true")
    r.add_argument("--marca", type=Path, help="marca.json: colores, logo como marca de agua y tarjeta de cierre.")
    r.add_argument("--vista-previa", nargs="?", const="auto", help="Solo 12 s a media resolución («auto» o segundo de inicio).")
    for sub in (p, h, e, r):
        sub.add_argument("--sin-descargas", action="store_true", help="No copia plan ni video a ~/Downloads/kiko_ediciones.")
    args = parser.parse_args()
    TRABAJO.mkdir(exist_ok=True)
    {"revisar": revisar, "planificar": planificar, "rehacer": rehacer, "editar": editar, "render": render}[args.paso](args)


if __name__ == "__main__":
    main()
