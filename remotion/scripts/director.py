"""El Director: analiza la toma y el objetivo del creador y recomienda qué skills usar y con qué ajustes.

1. `analizar`: mide la toma en local (imagen con Apple Vision y CoreImage, audio con loudnorm) y resume el
   contenido (duración, ritmo, libreto, gráficos posibles).
2. Con IA (Claude, ChatGPT o Gemini por sesión autorizada) el Director recibe esos hechos, el objetivo, las
   instrucciones y los recursos de cada skill y propone recomendaciones; sin IA se usan reglas locales.
3. Toda recomendación se valida contra el esquema de la skill: la IA no puede inventar ajustes ni recursos.
   El creador decide cuáles aplicar desde el panel.
"""

from __future__ import annotations

import json
from pathlib import Path

import skills as habilidades
from audio import RAIZ, TRABAJO, ejecutar, medir_loudness

MUESTRAS_VISUALES = 6


def _binario() -> Path:
    fuente = RAIZ / "scripts" / "analisis_visual.swift"
    binario = TRABAJO / "kiko-analisis-visual"
    if not binario.exists() or binario.stat().st_mtime < fuente.stat().st_mtime:
        TRABAJO.mkdir(parents=True, exist_ok=True)
        ejecutar("swiftc", "-O", str(fuente), "-o", str(binario))
    return binario


def medir_toma(clip: Path) -> dict:
    """Imagen y audio de una toma; si algo no se puede medir, se informa en vez de inventarlo."""
    medida: dict = {}
    try:
        medida["imagen"] = json.loads(ejecutar(str(_binario()), str(clip), str(MUESTRAS_VISUALES)).stdout)
    except Exception as exc:  # voz guía sin video, archivo raro…
        medida["imagen"] = {"error": str(exc)[:200]}
    try:
        audio = medir_loudness(clip)
        medida["audio"] = {"loudness_lufs": round(float(audio["input_i"]), 1), "pico_dbtp": round(float(audio["input_tp"]), 1)}
    except Exception as exc:
        medida["audio"] = {"error": str(exc)[:200]}
    return medida


def _promedio(valores: list[float]) -> float | None:
    valores = [v for v in valores if v is not None]
    return round(sum(valores) / len(valores), 3) if valores else None


def analizar(clips: list[Path], *, palabras: list, duracion_util: float, alineacion: dict | None,
             candidatos: list) -> dict:
    """Hechos de la toma para el Director, en números y en palabras."""
    medidas = [medir_toma(c) for c in clips]
    imagenes = [m["imagen"] for m in medidas if "error" not in m["imagen"]]
    audios = [m["audio"] for m in medidas if "error" not in m["audio"]]
    duracion = sum(m["imagen"].get("duracion", 0) for m in medidas) or (palabras[-1].fin if palabras else 0)
    imagen = {clave: _promedio([i.get(clave) for i in imagenes])
              for clave in ("brillo", "contraste", "saturacion", "calidez", "nitidez", "rostro_en")} if imagenes else {}
    rostros = [i["rostro"] for i in imagenes if i.get("rostro")]
    if rostros:
        imagen["rostro_tamano"] = _promedio([r["tamano"] for r in rostros])
        imagen["rostro_centro_y"] = _promedio([r["centro_y"] for r in rostros])
    if imagenes:
        imagen["vertical"] = all(i["alto"] > i["ancho"] for i in imagenes)
    audio = ({"loudness_lufs": _promedio([a["loudness_lufs"] for a in audios]),
              "pico_dbtp": max(a["pico_dbtp"] for a in audios)} if audios else {})
    tipos: dict[str, int] = {}
    for c in candidatos:
        tipos[c.componente] = tipos.get(c.componente, 0) + 1
    contenido = {
        "tomas": len(clips), "duracion_grabada_s": round(duracion, 1), "duracion_util_s": round(duracion_util, 1),
        "palabras": len(palabras),
        "palabras_por_minuto": round(len(palabras) / (duracion_util / 60), 0) if duracion_util else None,
        "graficos_posibles": tipos,
        "muletillas": sum(1 for p in palabras if p.texto.lower().strip(",.") in {"eh", "ehh", "em", "emm", "mm", "mmm", "ah"}),
    }
    if alineacion:
        contenido.update({
            "cobertura_libreto": alineacion["cobertura"],
            "lineas_repetidas": sum(1 for l in alineacion["lineas"] if l.get("otras_tomas")),
            "dicho_fuera_del_libreto": len(alineacion["fuera_del_libreto"]),
        })
    return {"imagen": imagen, "audio": audio, "contenido": contenido, "observaciones": observaciones(imagen, audio, contenido)}


def observaciones(imagen: dict, audio: dict, contenido: dict) -> list[str]:
    """Lo medido, en frases: es lo que el panel muestra y lo que la IA lee primero."""
    notas = []
    brillo = imagen.get("brillo")
    if brillo is not None:
        notas.append("Imagen oscura" if brillo < 0.3 else "Imagen muy clara" if brillo > 0.7 else "Exposición correcta")
    if imagen.get("contraste") is not None and imagen["contraste"] < 0.1:
        notas.append("contraste bajo (imagen plana)")
    if imagen.get("calidez") is not None:
        notas.append("color frío" if imagen["calidez"] < -0.04 else "color cálido" if imagen["calidez"] > 0.06 else "color neutro")
    if imagen.get("nitidez") is not None and imagen["nitidez"] < 0.015:
        notas.append("imagen algo blanda")
    if imagen.get("rostro_en") is not None:
        if imagen["rostro_en"] < 0.5:
            notas.append("el rostro no se ve en buena parte de la toma")
        elif imagen.get("rostro_tamano", 1) < 0.06:
            notas.append("rostro pequeño en el cuadro (plano abierto)")
        elif imagen.get("rostro_tamano", 0) > 0.2:
            notas.append("rostro muy cerca")
    if imagen.get("vertical") is False:
        notas.append("toma horizontal: se recorta a vertical")
    if audio.get("loudness_lufs") is not None:
        if audio["loudness_lufs"] < -30:
            notas.append(f"voz muy baja ({audio['loudness_lufs']:.0f} LUFS)")
        if audio.get("pico_dbtp", -10) > -0.5:
            notas.append("el audio satura en algunos picos")
    plural = lambda n, uno, varios: f"{n} {uno if n == 1 else varios}"  # noqa: E731
    if contenido.get("lineas_repetidas"):
        notas.append(plural(contenido["lineas_repetidas"], "línea grabada", "líneas grabadas") + " más de una vez")
    if contenido.get("dicho_fuera_del_libreto"):
        notas.append(plural(contenido["dicho_fuera_del_libreto"], "trozo dicho", "trozos dichos") + " fuera del libreto")
    if contenido.get("muletillas"):
        notas.append(plural(contenido["muletillas"], "muletilla", "muletillas") + " (eh, mmm…)")
    if contenido.get("palabras_por_minuto"):
        ppm = contenido["palabras_por_minuto"]
        notas.append("ritmo de habla rápido" if ppm > 175 else "ritmo de habla pausado" if ppm < 120 else "ritmo de habla natural")
    return notas


# --- Recomendaciones ----------------------------------------------------------------------------

def _rec(skill_id: str, usar: bool, motivo: str, **ajustes) -> dict:
    return {"skill": skill_id, "usar": usar, "motivo": motivo, "ajustes": ajustes}


def recomendaciones_locales(hechos: dict, skills: dict, objetivo: str) -> list[dict]:
    """Reglas simples sobre lo medido: sirven sin IA y como base que la IA puede mejorar."""
    imagen, audio, contenido = hechos["imagen"], hechos["audio"], hechos["contenido"]
    nivel = habilidades.ajuste(skills, "director", "nivel", "equilibrado")
    paso = {"conservador": 0.6, "equilibrado": 1.0, "audaz": 1.4}[nivel]
    texto = objetivo.lower()
    recs = [
        _rec("sonido", True, "La voz siempre se limpia y se normaliza a −14 LUFS para redes."
             + (" La voz está baja: más aislamiento ayuda a separarla del ruido." if audio.get("loudness_lufs", 0) < -30 else ""),
             **({"aislamiento": 80} if audio.get("loudness_lufs", 0) < -30 else {})),
        _rec("subtitulos", True, "En redes la mayoría ve sin sonido: los subtítulos sostienen el mensaje."),
    ]
    if contenido.get("lineas_repetidas") or contenido.get("dicho_fuera_del_libreto") or contenido.get("muletillas"):
        recs.append(_rec("recortes", True, "Hay repeticiones o trozos fuera del libreto que conviene quitar.",
                         **({"muletillas": True} if contenido.get("muletillas") else {})))
    if contenido.get("graficos_posibles"):
        densidad = "media" if nivel == "conservador" or "serio" in texto or "sobrio" in texto else None
        recs.append(_rec("efectos", True, f"Se detectaron {sum(contenido['graficos_posibles'].values())} momentos ilustrables.",
                         **({"densidad": densidad} if densidad else {})))
        recs.append(_rec("audio_fx", True, "Cada gráfico entra con su sonido, sincronizado con la palabra."))
    if contenido.get("lineas_repetidas") or contenido.get("tomas", 1) > 1:
        recs.append(_rec("edicion", True, "Hay cortes de montaje: el zoom en cada corte disimula el salto.",
                         **({"zoom_lento": True} if imagen.get("rostro_tamano", 1) < 0.06 else {})))
    elif imagen.get("rostro_tamano", 1) < 0.06:
        recs.append(_rec("edicion", True, "El rostro se ve pequeño: un acercamiento lento acerca al espectador.", zoom_lento=True))
    retoque = {}
    if imagen.get("brillo") is not None and imagen["brillo"] < 0.3:
        retoque["brillo"] = round(min(20, 10 * paso))
    if imagen.get("contraste") is not None and imagen["contraste"] < 0.1:
        retoque["contraste"] = round(min(20, 8 * paso))
    if imagen.get("nitidez") is not None and imagen["nitidez"] < 0.015:
        retoque["nitidez"] = round(min(100, 30 * paso) / 5) * 5
    if retoque:
        recs.append(_rec("retoques", True, "La imagen lo pide: " + ", ".join(
            n for n in hechos["observaciones"] if n.startswith(("Imagen", "contraste", "imagen"))) + ".", **retoque))
    emotivo = any(p in texto for p in ("emoci", "emotiv", "inspir", "motiva", "reflexi", "histori", "familia",
                                       "espiritual", "biblia", "cercan")) or " fe " in f" {texto} "
    if imagen.get("calidez") is not None and (imagen["calidez"] < -0.04 or emotivo) and nivel != "conservador":
        recs.append(_rec("filtros", True, "Un tono cálido acompaña un mensaje cercano o emotivo." if emotivo
                         else "La imagen está fría: un toque cálido mejora la piel.", preset="calido", intensidad=round(40 * paso / 5) * 5))
    if any(p in texto for p in ("seguidor", "marca", "crecer", "comunidad", "cuenta")):
        recs.append(_rec("superposiciones", True, "Para crecer la cuenta, tu marca debe verse en todo el video."))
    return validar(recs, skills, fuente="local")


def validar(propuestas: list, skills: dict, *, fuente: str) -> list[dict]:
    """Solo skills que existen, ajustes válidos y que la skill permite tocar; una recomendación por skill."""
    vistas, validas = set(), []
    for propuesta in propuestas if isinstance(propuestas, list) else []:
        if not isinstance(propuesta, dict):
            continue
        skill_id = propuesta.get("skill")
        skill = skills.get(skill_id)
        if not skill or skill_id in vistas or skill_id == "director":
            continue
        vistas.add(skill_id)
        ajustes = habilidades.validar_ajustes(skill, propuesta.get("ajustes") or {}, estricto=False) \
            if skill.get("director_ajusta", True) else {}
        cambios = {k: v for k, v in ajustes.items() if skill["ajustes"].get(k) != v}
        usar = bool(propuesta.get("usar", True))
        validas.append({
            "skill": skill_id, "nombre": skill.get("nombre", skill_id), "usar": usar,
            "motivo": " ".join(str(propuesta.get("motivo", "")).split())[:300],
            "ajustes": cambios, "resumen_ajustes": [habilidades.resumen_ajuste(skill, k, v) for k, v in cambios.items()],
            "cambia": usar != skill.get("activa", True) or bool(cambios), "fuente": fuente,
        })
    return validas


def seccion_prompt(objetivo: str, hechos: dict, skills: dict) -> str:
    """Lo que la IA necesita para orquestar: objetivo, hechos medidos y cada skill con su estado y límites."""
    lineas = []
    for skill_id, skill in skills.items():
        if skill_id == "director":
            continue
        parametros = []
        for p in skill.get("parametros", []):
            if p["tipo"] == "rango":
                rango = f"{p['min']}–{p['max']}"
            elif p["tipo"] in {"opcion", "multiple"}:
                rango = "|".join(o[0] for o in p["opciones"])
            elif p["tipo"] == "recurso":
                rango = "|".join([""] + [r["id"] for r in skill.get("recursos", []) if r["tipo"] == p["recurso_tipo"]])
            else:
                rango = p["tipo"]
            parametros.append(f"{p['clave']}={json.dumps(skill['ajustes'].get(p['clave']), ensure_ascii=False)} ({rango})")
        recursos = ", ".join(f"{r['id']}: {r['nombre']}" for r in skill.get("recursos", []) if r["tipo"] != "document")
        documentos = " ".join(r.get("texto", "")[:800] for r in skill.get("recursos", []) if r["tipo"] == "document")
        lineas.append(
            f"- {skill_id} ({skill['nombre']}, {'activa' if skill.get('activa', True) else 'inactiva'}"
            f"{'' if skill.get('director_ajusta', True) else ', NO cambies sus ajustes'}): {skill.get('descripcion', '')}\n"
            f"  Instrucciones: {skill.get('instrucciones', '')}\n  Ajustes: {'; '.join(parametros)}"
            + (f"\n  Recursos: {recursos}" if recursos else "") + (f"\n  Conocimiento: {documentos}" if documentos else "")
        )
    director = skills.get("director", {})
    conocimiento = " ".join(r.get("texto", "") for r in director.get("recursos", []) if r["tipo"] == "document")[:4000]
    return f"""
También eres el Director que orquesta las skills de edición. {director.get('instrucciones', '')}
Nivel de intervención: {habilidades.ajuste(skills, 'director', 'nivel', 'equilibrado')}.
{('Conocimiento del creador: ' + conocimiento) if conocimiento else ''}
Objetivo del creador para esta edición: {objetivo or 'no lo indicó; dedúcelo del contenido'}
Análisis medido de la toma: {json.dumps(hechos, ensure_ascii=False)}
Skills disponibles (estado, instrucciones y ajustes actuales con sus valores permitidos):
{chr(10).join(lineas)}
Recomienda qué skills usar en esta edición y con qué ajustes, solo con los valores permitidos y basándote
en el análisis y el objetivo. Incluye solo las skills donde tengas algo que decir.
Agrega al JSON la clave "director": {{"objetivo": "cómo entendiste el objetivo", "resumen": "2 frases",
"recomendaciones": [{{"skill": "filtros", "usar": true, "motivo": "una frase", "ajustes": {{"preset": "calido"}}}}]}}"""
