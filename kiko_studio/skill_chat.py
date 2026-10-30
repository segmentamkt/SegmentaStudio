"""Conversar con cada skill dentro de Kiko Studio.

Cada skill ve lo que hizo en el video que eliges, responde con la IA de tus sesiones autorizadas (Claude,
ChatGPT o Gemini, sin claves) y propone cambios con sus herramientas. Nada se aplica solo: cada propuesta se
valida, se prueba en una copia del plan y llega como tarjeta; al aplicarla se guarda una copia para deshacer.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import threading
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from uuid import uuid4

from multiagent_core import SQLiteStore
from kiko_studio.image_generator import ESTILOS
from kiko_studio.semantic_editor import NOMBRES, REMOTION
from kiko_studio.skills import POR_ID, motor

KIKO = Path(__file__).resolve().parents[1]
ICONOS = REMOTION / "node_modules" / "@tabler" / "icons" / "icons" / "outline"
SONIDOS = ("whoosh", "pop", "impacto", "ovacion", "clic", "vibracion", "ping")
PREFERENCIA = ("claude-cli", "codex-cli", "gemini-cli")
MAX_ACCIONES = 8
HISTORIAL = 12

# Cada herramienta: qué hace (para la IA y la tarjeta) y sus argumentos.
HERRAMIENTAS = {
    "ajustar": ("Cambia ajustes de una skill. alcance «video» = solo este video; «siempre» = queda por defecto "
                "para los próximos videos (y también en este).",
                '{"skill": "id", "ajustes": {"clave": valor}, "alcance": "video|siempre"}'),
    "activar": ("Activa o apaga una skill.", '{"skill": "id", "activa": true, "alcance": "video|siempre"}'),
    "reescribir_instrucciones": ("Reemplaza las instrucciones de una skill; quedan para los próximos videos.",
                                 '{"skill": "id", "instrucciones": "texto completo nuevo"}'),
    "quitar_grafico": ("Quita un gráfico, una imagen o un sonido del video.", '{"id": "id de la lista de gráficos"}'),
    "cambiar_texto": ("Cambia lo que dice un texto grande o una copa.", '{"id": "...", "texto": "..."}'),
    "mover_grafico": ("Adelanta o atrasa un gráfico (−3 a 3 s) o fija cuánto dura (0,5 a 8 s; 0 = automático).",
                      '{"id": "...", "ajuste_inicio": 0.0, "duracion": 0}'),
    "agregar_grafico": ("Pone un gráfico cuando se dice una frase: texto grande, ícono Tabler o mapa de un país.",
                        '{"tipo": "texto|icono|mapa", "frase": "tal como se dice", "texto": "solo tipo texto", '
                        '"icono": "nombre Tabler outline", "pais": "nombre o código"}'),
    "cambiar_icono": ("Cambia el ícono de un gráfico de ícono.", '{"id": "...", "icono": "nombre Tabler outline"}'),
    "poner_imagen": ("Pone una imagen de la biblioteca del proyecto cuando se dice una frase.",
                     '{"imagen": "nombre en la biblioteca", "frase": "tal como se dice"}'),
    "generar_imagen": ("Genera una imagen nueva con IA; queda en el generador del editor para que la apruebes.",
                       '{"descripcion": "qué se ve", "nombre": "nombre-corto", "proveedor": "auto|codex|gemini|ambas", '
                       '"estilo": "foto|ilustracion|3d|acuarela|cine"}'),
    "quitar_frase": ("Corta una frase del video.", '{"frase": "tal como se dice en el video"}'),
    "recuperar_frase": ("Devuelve al video una frase que quedó cortada.", '{"frase": "tal como se dijo en la toma"}'),
    "elegir_montaje": ("Rearma todo el montaje: «libreto», «original» (tomas completas) o una opción sugerida.",
                       '{"opcion": "libreto|original|..."}'),
    "zoom_en_frase": ("Acercamiento rápido de cámara en una frase (2 a 20 %).", '{"frase": "...", "intensidad": 10}'),
    "quitar_zoom": ("Quita un acercamiento: «gancho», «remate» o el id de uno pedido.", '{"cual": "gancho|remate|z1"}'),
    "quitar_sonido": ("Quita el efecto de sonido de un gráfico; el gráfico se queda.", '{"id": "..."}'),
    "agregar_sonido": ("Pone un efecto de sonido cuando se dice una frase.",
                       '{"sonido": "whoosh|pop|impacto|ovacion|clic|vibracion|ping", "frase": "..."}'),
    "corregir_palabra": ("Corrige una palabra mal transcrita: cambian los subtítulos y los textos que salen de lo dicho.",
                         '{"dice": "como sale", "correcta": "como se escribe", "todas": true}'),
    "aplicar_recomendacion": ("Aplica en este video lo que el Director recomendó para una skill.", '{"skill": "id"}'),
}
COMUNES = ("ajustar", "activar", "reescribir_instrucciones")
POR_SKILL = {
    "director": tuple(HERRAMIENTAS),
    "sonido": COMUNES,
    "efectos": COMUNES + ("quitar_grafico", "cambiar_texto", "mover_grafico", "agregar_grafico", "cambiar_icono"),
    "recortes": COMUNES + ("quitar_frase", "recuperar_frase", "elegir_montaje"),
    "edicion": COMUNES + ("zoom_en_frase", "quitar_zoom"),
    "filtros": COMUNES,
    "generador": COMUNES + ("generar_imagen", "poner_imagen", "quitar_grafico"),
    "superposiciones": COMUNES,
    "audio_fx": COMUNES + ("quitar_sonido", "agregar_sonido"),
    "subtitulos": COMUNES + ("corregir_palabra",),
    "retoques": COMUNES,
}
TIPOS_GRAFICO = {"texto": "texto_cinetico", "icono": "icono", "mapa": "mapa_pais"}
# Lo que cambia el plan y se compara para saber si alguien lo tocó después de un cambio del chat.
_FIRMA = ("eventos", "montaje", "camara", "skills", "palabras_fuente", "zoom_frases", "zoom_quitados", "recursos")


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _s(segundos: float) -> str:
    return f"{segundos:.1f}".replace(".", ",")


def _clave(nombre: str) -> str:
    base = "".join(c for c in unicodedata.normalize("NFD", Path(str(nombre)).stem.lower()) if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "", base)


def _numero(valor, nombre: str) -> float:
    try:
        return float(valor)
    except (TypeError, ValueError):
        raise ValueError(f"«{valor}» no es un número válido para {nombre}") from None


def _firma(plan: dict) -> str:
    return hashlib.sha256(json.dumps({k: plan.get(k) for k in _FIRMA}, sort_keys=True).encode()).hexdigest()


def _proveedor_cli(preferido: str):
    from multiagent_core.providers import detect_cli_providers

    gemini = KIKO / ".tools" / "gemini" / "node_modules" / ".bin" / "gemini"
    disponibles = {p.name: p for p in detect_cli_providers(
        executables={"gemini": str(gemini)} if gemini.exists() else None, timeout_seconds=240,
    )}
    orden = PREFERENCIA if preferido == "auto" else (f"{preferido}-cli",)
    return next((disponibles[nombre] for nombre in orden if nombre in disponibles), None)


def _sumar(total: dict, cambios: dict) -> None:
    """Junta los cambios de varias herramientas en un solo cambios.json para el editor."""
    for clave, valor in cambios.items():
        if isinstance(valor, list):
            total.setdefault(clave, []).extend(valor)
        elif clave == "skills":
            for skill_id, cambio in valor.items():
                destino = total.setdefault("skills", {}).setdefault(skill_id, {})
                destino.update({k: v for k, v in cambio.items() if k != "ajustes"})
                destino.setdefault("ajustes", {}).update(cambio.get("ajustes", {}))
        elif isinstance(valor, dict):
            total.setdefault(clave, {}).update(valor)
        else:
            total[clave] = valor


class SkillChat:
    def __init__(self, store: SQLiteStore, skills, semantic, imagenes, biblioteca: Callable[[str], list[dict]], *,
                 proveedor: Callable[[str], object] | None = None) -> None:
        self.store, self.skills, self.semantic, self.imagenes, self.biblioteca = store, skills, semantic, imagenes, biblioteca
        self.proveedor = proveedor or _proveedor_cli
        self.ocupadas: set[tuple[str, str]] = set()
        self.candado = threading.Lock()
        with self.store.transaction(immediate=True) as con:
            con.executescript(
                """
                CREATE TABLE IF NOT EXISTS skill_chat(
                    id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, edit_id TEXT NOT NULL DEFAULT '', rol TEXT NOT NULL,
                    texto TEXT NOT NULL DEFAULT '', acciones TEXT NOT NULL DEFAULT '[]', estado TEXT NOT NULL,
                    detalle TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_skill_chat ON skill_chat(skill_id, edit_id, created_at);
                """
            )
            # Lo que quedó pensando cuando se cerró la plataforma ya no va a llegar.
            con.execute("UPDATE skill_chat SET estado='error', texto='Se interrumpió al cerrar Kiko Studio; vuelve a enviarlo.' "
                        "WHERE estado='pensando'")

    # --- Conversación -------------------------------------------------------------------------

    def herramientas(self, skill_id: str) -> list[dict]:
        return [{"nombre": h, "descripcion": HERRAMIENTAS[h][0]} for h in POR_SKILL[self._skill(skill_id)]]

    def conversacion(self, skill_id: str, edit_id: str = "") -> dict:
        skill_id = self._skill(skill_id)
        with self.store.lock:
            filas = self.store.connection.execute(
                "SELECT * FROM skill_chat WHERE skill_id=? AND edit_id=? ORDER BY created_at, rowid", (skill_id, edit_id)
            ).fetchall()
        mensajes = [self._mensaje(dict(f)) for f in filas]
        firma = None
        if edit_id and any(m["estado"] == "aplicada" for m in mensajes):
            try:
                firma = _firma(self.semantic.leer_plan(edit_id))
            except ValueError:
                firma = None
        for m in mensajes:
            deshacer = m["detalle"].get("deshacer") or {}
            m["deshacible"] = m["estado"] == "aplicada" and (not deshacer.get("plan") or deshacer.get("firma") == firma)
        return {"items": mensajes, "herramientas": self.herramientas(skill_id),
                "ocupada": (skill_id, edit_id) in self.ocupadas}

    def enviar(self, skill_id: str, edit_id: str, texto: str) -> dict:
        skill_id = self._skill(skill_id)
        texto = str(texto).strip()[:2000]
        if not texto:
            raise ValueError("Escribe tu mensaje")
        if edit_id:
            self.semantic.leer_plan(edit_id)  # el video existe y tiene plan
        with self.candado:
            if (skill_id, edit_id) in self.ocupadas:
                raise ValueError("La skill todavía está respondiendo tu mensaje anterior")
            self.ocupadas.add((skill_id, edit_id))
        self._insertar(skill_id, edit_id, "usuario", texto, "enviado")
        respuesta = self._insertar(skill_id, edit_id, "skill", "", "pensando")
        threading.Thread(target=self._responder, args=(respuesta, skill_id, edit_id), daemon=True,
                         name=f"skill-chat-{skill_id}").start()
        return self.conversacion(skill_id, edit_id)

    def borrar(self, skill_id: str, edit_id: str = "") -> dict:
        skill_id = self._skill(skill_id)
        if (skill_id, edit_id) in self.ocupadas:
            raise ValueError("Espera a que la skill termine de responder")
        with self.store.transaction(immediate=True) as con:
            con.execute("DELETE FROM skill_chat WHERE skill_id=? AND edit_id=?", (skill_id, edit_id))
        return self.conversacion(skill_id, edit_id)

    # --- Aplicar y deshacer -------------------------------------------------------------------

    def aplicar(self, mensaje_id: str, indices: list[int] | None = None) -> dict:
        mensaje = self._fila(mensaje_id)
        if mensaje["estado"] != "lista":
            raise ValueError("Esta propuesta ya se aplicó o ya no está disponible")
        skill_id, edit_id = mensaje["skill_id"], mensaje["edit_id"]
        elegidas = [a for k, a in enumerate(mensaje["acciones"]) if a.get("valida") and (indices is None or k in indices)]
        if not elegidas:
            raise ValueError("No hay cambios válidos para aplicar")
        contexto = self._contexto(edit_id)
        traducidas = [self._traducir(skill_id, a["herramienta"], a["args"], contexto) for a in elegidas]
        cambios, config = self._juntar(traducidas, contexto)
        deshacer: dict = {"plan": None, "skills": {}}
        if cambios:
            ruta = self.semantic.ruta_plan(edit_id)
            copia = ruta.parent / "deshacer" / f"{mensaje_id}.json"
            copia.parent.mkdir(exist_ok=True)
            shutil.copy2(ruta, copia)
            self.semantic.editar(edit_id, cambios)
            deshacer.update(plan=str(copia), firma=_firma(self.semantic.leer_plan(edit_id)))
        try:
            for destino, cambio in config.items():
                antes = self.skills.instantanea(destino)
                self.skills.guardar(destino, cambio)
                deshacer["skills"][destino] = {"antes": antes, "despues": self.skills.instantanea(destino)}
        except ValueError:
            if deshacer["plan"]:
                self.semantic.restaurar_plan(edit_id, Path(deshacer["plan"]))
            raise
        imagenes = []
        for t in traducidas:
            if t.get("imagen"):
                imagenes += [i["id"] for i in self.imagenes.generar(contexto["project_id"], **t["imagen"])]
        detalle = {**mensaje["detalle"], "deshacer": deshacer, "aplicadas": [mensaje["acciones"].index(a) for a in elegidas],
                   "imagenes": imagenes, "aplicada_en": _ahora()}
        self._actualizar(mensaje_id, estado="aplicada", detalle=detalle)
        return self.conversacion(skill_id, edit_id)

    def deshacer(self, mensaje_id: str) -> dict:
        mensaje = self._fila(mensaje_id)
        if mensaje["estado"] != "aplicada":
            raise ValueError("Ese cambio no está aplicado")
        skill_id, edit_id = mensaje["skill_id"], mensaje["edit_id"]
        deshacer = mensaje["detalle"].get("deshacer") or {}
        if deshacer.get("plan"):
            if _firma(self.semantic.leer_plan(edit_id)) != deshacer.get("firma"):
                raise ValueError("El video cambió después de este cambio; deshaz primero los cambios más recientes")
            self.semantic.restaurar_plan(edit_id, Path(deshacer["plan"]))
        omitidas = []
        for destino, estado in (deshacer.get("skills") or {}).items():
            if self.skills.instantanea(destino) != estado["despues"]:
                omitidas.append(POR_ID[destino]["nombre"])  # la cambiaste después: no se pisa
                continue
            self.skills.restaurar(destino, estado["antes"])
        detalle = {**mensaje["detalle"], "deshecha_en": _ahora(),
                   **({"aviso": f"No se restauró {', '.join(omitidas)} porque la cambiaste después."} if omitidas else {})}
        self._actualizar(mensaje_id, estado="deshecha", detalle=detalle)
        return self.conversacion(skill_id, edit_id)

    # --- Respuesta de la IA -------------------------------------------------------------------

    def _responder(self, mensaje_id: str, skill_id: str, edit_id: str) -> None:
        inicio = time.time()
        try:
            contexto = self._contexto(edit_id)
            preferido = self.skills.obtener("director")["ajustes"].get("proveedor", "auto")
            proveedor = self.proveedor(preferido)
            if proveedor is None:
                raise RuntimeError("No hay una IA conectada: abre Claude, ChatGPT o Gemini con tu sesión e inténtalo de nuevo")
            salida = proveedor.generate(self._prompt(skill_id, edit_id, contexto)).content
            respuesta = self._leer_json(salida)
            acciones = self._revisar(skill_id, respuesta.get("acciones") or [], contexto)
            resultado = self._probar(acciones, contexto) if any(a.get("cambios") for a in acciones) else {}
            for accion in acciones:
                accion.pop("cambios", None)
            texto = str(respuesta.get("respuesta") or "").strip()[:4000] or (
                "Revisa la propuesta." if acciones else "No recibí una respuesta clara; dilo de otra forma, por favor.")
            self._actualizar(mensaje_id, texto=texto, acciones=acciones, estado="lista",
                             detalle={"proveedor": getattr(proveedor, "name", ""), "segundos": round(time.time() - inicio, 1),
                                      **resultado})
        except Exception as exc:  # el error llega al chat en lugar de colgar la conversación
            self._actualizar(mensaje_id, texto=f"No pude responder: {str(exc)[:400]}", estado="error",
                             detalle={"segundos": round(time.time() - inicio, 1)})
        finally:
            with self.candado:
                self.ocupadas.discard((skill_id, edit_id))

    @staticmethod
    def _leer_json(texto: str) -> dict:
        bloque = re.search(r"\{.*\}", texto or "", re.S)
        try:
            datos = json.loads(bloque.group(0)) if bloque else None
        except json.JSONDecodeError:
            datos = None
        if not isinstance(datos, dict):
            return {"respuesta": (texto or "").strip(), "acciones": []}
        return datos

    def _revisar(self, skill_id: str, propuestas: list, contexto: dict) -> list[dict]:
        """Cada acción de la IA se valida aquí: solo herramientas de esta skill y valores que existen."""
        acciones = []
        for propuesta in propuestas[:MAX_ACCIONES]:
            herramienta = str((propuesta or {}).get("herramienta", "")) if isinstance(propuesta, dict) else ""
            args = propuesta.get("args") if isinstance(propuesta, dict) and isinstance(propuesta.get("args"), dict) else {}
            accion = {"herramienta": herramienta, "args": args}
            try:
                traducida = self._traducir(skill_id, herramienta, args, contexto)
                accion.update(valida=True, descripcion=traducida["descripcion"], cambios=traducida.get("cambios"),
                              **({"texto_completo": traducida["texto_completo"]} if traducida.get("texto_completo") else {}))
            except (ValueError, TypeError) as exc:
                accion.update(valida=False, descripcion=HERRAMIENTAS.get(herramienta, (herramienta,))[0], error=str(exc))
            acciones.append(accion)
        return acciones

    def _probar(self, acciones: list[dict], contexto: dict) -> dict:
        """Prueba los cambios del plan en una copia; si fallan juntos, se busca cuál falla."""
        con_plan = [a for a in acciones if a.get("valida") and a.get("cambios")]

        def simular(grupo: list[dict]) -> tuple[dict, dict]:
            cambios: dict = {}
            for accion in grupo:
                _sumar(cambios, accion["cambios"])
            if not contexto["plan"].get("skills") and "skills" in cambios:
                cambios["skills_base"] = self.skills.para_motor()
            return self.semantic.simular(contexto["edit_id"], cambios)

        try:
            antes, despues = simular(con_plan)
        except ValueError:
            for accion in con_plan:
                try:
                    simular([accion])
                except ValueError as exc:
                    accion.update(valida=False, error=str(exc))
            validas = [a for a in con_plan if a["valida"]]
            if not validas:
                return {}
            antes, despues = simular(validas)
        return self._resultado(antes, despues)

    @staticmethod
    def _resultado(antes: dict, despues: dict) -> dict:
        """Qué cambia en el video, en palabras, y desde qué segundo conviene mirar la vista previa."""
        lineas, avisos, momentos = [], [], []
        if abs(antes["duracion"] - despues["duracion"]) >= 0.05:
            lineas.append(f"El video pasa de {_s(antes['duracion'])} s a {_s(despues['duracion'])} s.")
        previos = {e["id"]: e for e in antes["eventos"]}
        actuales = {e["id"]: e for e in despues["eventos"]}

        def nombre(e: dict) -> str:
            detalle = e["params"].get("icono") or e["params"].get("nombre") or e["params"].get("recurso") or e["params"].get("texto")
            return NOMBRES.get(e["componente"], e["componente"]) + (f" «{detalle}»" if detalle else "")

        for e in despues["eventos"]:
            if e["id"] not in previos:
                lineas.append(f"Entra {nombre(e)} a los {_s(e['inicio'])} s, cuando dice «{e['ancla']['texto']}».")
                momentos.append(e["inicio"])
            elif (e["inicio"], e["fin"], e["params"], e["sonidos"]) != tuple(previos[e["id"]].get(k) for k in ("inicio", "fin", "params", "sonidos")):
                lineas.append(f"Cambia {nombre(e)} ({_s(e['inicio'])}–{_s(e['fin'])} s).")
                momentos.append(e["inicio"])
        for e in antes["eventos"]:
            if e["id"] not in actuales:
                lineas.append(f"Sale {nombre(e)} de los {_s(e['inicio'])} s.")
                momentos.append(e["inicio"])
        vistos = {json.dumps(d, sort_keys=True) for d in antes.get("descartados", [])}
        for d in despues.get("descartados", []):
            if d.get("fuente") == "usuario" and json.dumps(d, sort_keys=True) not in vistos and "Quitado en la revisión" not in d["motivo"]:
                avisos.append(f"{NOMBRES.get(d['componente'], d['componente'])} «{d['ancla']}» no entra: {d['motivo']}")
        zoom_antes = {(z["inicio"], z["motivo"]) for z in antes["camara"]["zoom"]}
        for z in despues["camara"]["zoom"]:
            if (z["inicio"], z["motivo"]) not in zoom_antes and not z["motivo"].startswith("Corte de montaje"):
                lineas.append(f"{z['motivo']} a los {_s(z['inicio'])} s.")
                momentos.append(z["inicio"])
        nuevas = despues.get("correcciones", [])[len(antes.get("correcciones", [])):]
        veces: dict[tuple[str, str], int] = {}
        for correccion in nuevas:
            veces[(correccion["de"], correccion["a"])] = veces.get((correccion["de"], correccion["a"]), 0) + 1
        for (de, a), cuantas in veces.items():
            lineas.append(f"Corrige «{de}» → «{a}»" + (f" ({cuantas} veces)." if cuantas > 1 else "."))
        if nuevas:
            momentos += [p["inicio"] for p in despues["palabras"] if p["texto"] == nuevas[0]["a"]][:1]
        if not momentos and antes["montaje"].get("tramos") != despues["montaje"].get("tramos"):
            pares = zip(antes["montaje"].get("tramos", []), despues["montaje"].get("tramos", []))
            momentos.append(next((b["salida"] for a, b in pares if a != b), 0.0))
        if not lineas and not avisos:
            lineas.append("Cambia cómo se ve o suena el video al renderizarlo.")
        return {"resultado": lineas, "avisos": avisos,
                "inicio_vista": round(max(0.0, min(momentos) - 1.5), 1) if momentos else None}

    # --- Herramientas -------------------------------------------------------------------------

    def _traducir(self, skill_id: str, herramienta: str, args: dict, contexto: dict) -> dict:
        """Una acción → descripción para la tarjeta + cambios del plan, de la configuración o imagen a generar."""
        if herramienta not in HERRAMIENTAS:
            raise ValueError(f"«{herramienta}» no es una herramienta")
        if herramienta not in POR_SKILL[skill_id]:
            raise ValueError(f"{POR_ID[skill_id]['nombre']} no tiene la herramienta «{herramienta}»")
        plan = contexto["plan"]
        if herramienta in COMUNES:
            return self._config(skill_id, herramienta, args, plan)
        if not plan:
            raise ValueError("Para esto elige un video arriba")
        eventos = {e["id"]: e for e in plan["eventos"]}

        def evento(*componentes: str) -> dict:
            elegido = eventos.get(str(args.get("id", "")))
            if not elegido:
                raise ValueError(f"No hay un gráfico «{args.get('id')}» en este video")
            if componentes and elegido["componente"] not in componentes:
                raise ValueError(f"«{elegido['ancla']['texto']}» es {NOMBRES.get(elegido['componente'], elegido['componente']).lower()}; "
                                 "esta herramienta no sirve para ese gráfico")
            return elegido

        def frase() -> str:
            texto = " ".join(str(args.get("frase", "")).split())[:200]
            if not texto:
                raise ValueError("Falta la frase, tal como se dice en el video")
            return texto

        def icono(nombre: str) -> str:
            nombre = str(nombre or "").strip().lower()
            if not re.fullmatch(r"[a-z0-9-]+", nombre) or not (ICONOS / f"{nombre}.svg").is_file():
                raise ValueError(f"El ícono «{nombre}» no existe en Tabler (tabler.io/icons)")
            return nombre

        def describir(e: dict) -> str:
            detalle = str(e["params"].get("icono") or e["params"].get("nombre") or e["params"].get("recurso") or e["params"].get("texto") or "")
            detalle = detalle if len(detalle) <= 30 else detalle[:29].rstrip() + "…"
            return f"{NOMBRES.get(e['componente'], e['componente'])}{f' «{detalle}»' if detalle else ''} de los {_s(e['inicio'])} s"

        if herramienta == "quitar_grafico":
            e = evento()
            return {"descripcion": f"Quitar {describir(e)} («{e['ancla']['texto']}»).", "cambios": {"quitar": [e["id"]]}}
        if herramienta == "cambiar_texto":
            e = evento("texto_cinetico", "trofeo")
            texto = " ".join(str(args.get("texto", "")).split())[:90]
            if not texto:
                raise ValueError("El texto no puede quedar vacío")
            return {"descripcion": f"{NOMBRES[e['componente']]} de los {_s(e['inicio'])} s: «{e['params'].get('texto', '')}» → «{texto.upper()}».",
                    "cambios": {"textos": {e["id"]: texto}}}
        if herramienta == "mover_grafico":
            e = evento()
            ajuste = {}
            if args.get("ajuste_inicio") not in (None, ""):
                ajuste["ajuste_inicio"] = max(-3.0, min(3.0, _numero(args["ajuste_inicio"], "mover el gráfico")))
            if args.get("duracion") not in (None, ""):
                duracion = _numero(args["duracion"], "la duración")
                ajuste["duracion"] = 0 if duracion == 0 else max(0.5, min(8.0, duracion))
            if not ajuste:
                raise ValueError("Di cuánto mover el gráfico o cuánto debe durar")
            partes = ([f"{'atrasar' if ajuste['ajuste_inicio'] > 0 else 'adelantar'} {_s(abs(ajuste['ajuste_inicio']))} s"]
                      if ajuste.get("ajuste_inicio") else []) + \
                     ([f"que dure {_s(ajuste['duracion'])} s" if ajuste["duracion"] else "duración automática"]
                      if "duracion" in ajuste else [])
            return {"descripcion": f"{describir(e)}: {' y '.join(partes) or 'tiempo automático'}.",
                    "cambios": {"ajustes": {e["id"]: ajuste}}}
        if herramienta == "agregar_grafico":
            tipo = TIPOS_GRAFICO.get(str(args.get("tipo", "")))
            if not tipo:
                raise ValueError("El tipo de gráfico debe ser texto, icono o mapa")
            pedido = {"componente": tipo, "frase": frase()}
            if tipo == "icono":
                pedido["icono"] = icono(args.get("icono"))
            elif tipo == "mapa_pais":
                pedido["pais"] = str(args.get("pais", "")).strip()[:60]
            elif args.get("texto"):
                pedido["texto"] = " ".join(str(args["texto"]).split())[:90]
            que = (f"ícono «{pedido['icono']}»" if tipo == "icono" else f"mapa de {pedido['pais']}" if tipo == "mapa_pais"
                   else f"texto grande «{(pedido.get('texto') or pedido['frase']).upper()}»")
            return {"descripcion": f"Agregar {que} cuando dice «{pedido['frase']}».", "cambios": {"agregar_eventos": [pedido]}}
        if herramienta == "cambiar_icono":
            e = evento("icono")
            nuevo = icono(args.get("icono"))
            return {"descripcion": f"Ícono de los {_s(e['inicio'])} s («{e['ancla']['texto']}»): «{e['params'].get('icono')}» → «{nuevo}».",
                    "cambios": {"iconos": {e["id"]: nuevo}}}
        if herramienta == "poner_imagen":
            disponibles = [r for r in self.biblioteca(contexto["project_id"]) if r["tipo"] in {"image", "logo"}]
            buscada = _clave(args.get("imagen", ""))
            recurso = next((r for r in disponibles if _clave(r["nombre"]) == buscada), None)
            if not recurso:
                nombres = ", ".join(r["nombre"] for r in disponibles[:8]) or "ninguna todavía"
                raise ValueError(f"No encuentro la imagen «{args.get('imagen')}» en la biblioteca (hay: {nombres})")
            texto = frase()
            return {"descripcion": f"Poner la imagen «{recurso['nombre']}» cuando dice «{texto}».",
                    "cambios": {"recursos_nuevos": [recurso],
                                "agregar_eventos": [{"componente": "imagen", "frase": texto, "recurso": recurso["nombre"]}]}}
        if herramienta == "generar_imagen":
            descripcion = " ".join(str(args.get("descripcion", "")).split())[:600]
            if len(descripcion.split()) < 2:
                raise ValueError("Describe la imagen con algunas palabras")
            proveedor = str(args.get("proveedor") or "auto")
            estilo = str(args.get("estilo") or self.skills.obtener("generador")["ajustes"].get("estilo", "foto"))
            if proveedor not in {"auto", "ambas", "codex", "gemini"} or estilo not in ESTILOS:
                raise ValueError("Proveedor o estilo de imagen no válido")
            nombre = str(args.get("nombre") or descripcion)[:60]
            quien = {"auto": "la IA disponible", "ambas": "ChatGPT y Gemini", "codex": "ChatGPT", "gemini": "Gemini"}[proveedor]
            return {"descripcion": f"Generar con {quien} «{descripcion}» (estilo {estilo}); llega al generador del editor para aprobarla.",
                    "imagen": {"descripcion": descripcion, "nombre": nombre, "estilo": estilo, "proveedor": proveedor}}
        if herramienta == "quitar_frase":
            texto = frase()
            return {"descripcion": f"Cortar «{texto}».", "cambios": {"quitar_frases": [texto]}}
        if herramienta == "recuperar_frase":
            texto = frase()
            return {"descripcion": f"Recuperar «{texto}».", "cambios": {"recuperar_frases": [texto]}}
        if herramienta == "elegir_montaje":
            opciones = {"libreto": "Solo las líneas del libreto", "original": "Las tomas completas, sin cortes",
                        **{k: v["descripcion"] for k, v in ((plan.get("sugerencias_montaje") or {}).get("opciones") or {}).items()}}
            opcion = str(args.get("opcion", ""))
            if opcion not in opciones or (opcion == "libreto" and not plan.get("libreto")):
                raise ValueError(f"No hay un montaje «{opcion}» para este video")
            return {"descripcion": f"Rearmar el montaje: {opciones[opcion]}.", "cambios": {"montaje": opcion}}
        if herramienta == "zoom_en_frase":
            texto = frase()
            intensidad = max(2.0, min(20.0, _numero(args.get("intensidad") or 10, "la intensidad")))
            return {"descripcion": f"Acercamiento del {_s(intensidad).replace(',0', '')} % cuando dice «{texto}».",
                    "cambios": {"zoom_frases": [{"frase": texto, "intensidad": intensidad}]}}
        if herramienta == "quitar_zoom":
            cual = str(args.get("cual", ""))
            pedidos = {z["id"]: z for z in plan.get("zoom_frases", [])}
            if cual not in {"gancho", "remate"} and cual not in pedidos:
                raise ValueError(f"No hay un acercamiento «{cual}»")
            que = {"gancho": "el acercamiento del gancho", "remate": "el acercamiento de remate"}.get(cual) \
                or f"el acercamiento en «{pedidos.get(cual, {}).get('texto')}»"
            return {"descripcion": f"Quitar {que}.", "cambios": {"quitar_zoom": [cual]}}
        if herramienta == "quitar_sonido":
            e = evento()
            if not e.get("sonidos"):
                raise ValueError(f"{describir(e)} no tiene sonido")
            return {"descripcion": f"Quitar el sonido de {describir(e)}; el gráfico se queda.", "cambios": {"sin_sonido": [e["id"]]}}
        if herramienta == "agregar_sonido":
            sonido = str(args.get("sonido", ""))
            if sonido not in SONIDOS:
                raise ValueError(f"No hay un sonido «{sonido}»; usa {', '.join(SONIDOS)}")
            texto = frase()
            return {"descripcion": f"Sonido «{sonido}» cuando dice «{texto}».",
                    "cambios": {"agregar_eventos": [{"componente": "sonido", "frase": texto, "sonido": sonido}]}}
        if herramienta == "corregir_palabra":
            dice, correcta = " ".join(str(args.get("dice", "")).split())[:80], " ".join(str(args.get("correcta", "")).split())[:80]
            if not dice or not correcta:
                raise ValueError("Di cómo sale la palabra y cómo se escribe")
            todas = args.get("todas", True) is not False
            return {"descripcion": f"Corregir «{dice}» → «{correcta}»{' en todo el video' if todas else ' la primera vez'}.",
                    "cambios": {"corregir": [{"dice": dice, "correcta": correcta, "todas": todas}]}}
        # aplicar_recomendacion
        destino = self._destino(skill_id, args)
        recomendacion = next((r for r in (plan.get("director") or {}).get("recomendaciones", []) if r["skill"] == destino), None)
        if not recomendacion:
            raise ValueError(f"El Director no recomendó nada para {POR_ID[destino]['nombre']} en este video")
        return {"descripcion": f"Recomendación para {POR_ID[destino]['nombre']}: {recomendacion.get('motivo', '')}",
                "cambios": {"skills": {destino: {"activa": bool(recomendacion.get("usar", True)),
                                                 "ajustes": recomendacion.get("ajustes") or {}}},
                            "recomendaciones_aplicadas": [destino]}}

    def _destino(self, skill_id: str, args: dict) -> str:
        """El Director trabaja sobre cualquier skill (si ella lo permite); las demás, solo sobre sí mismas."""
        destino = str(args.get("skill") or skill_id) if skill_id == "director" else skill_id
        if destino not in POR_ID:
            raise ValueError(f"No hay una skill «{destino}»")
        if skill_id == "director" and destino != "director" and not self.skills.obtener(destino)["director_ajusta"]:
            raise ValueError(f"{POR_ID[destino]['nombre']} no deja que el Director la cambie; pídeselo en su propio chat")
        return destino

    def _config(self, skill_id: str, herramienta: str, args: dict, plan: dict | None) -> dict:
        destino = self._destino(skill_id, args)
        base, guardada = POR_ID[destino], self.skills.obtener(destino)
        nombre = base["nombre"]
        if herramienta == "reescribir_instrucciones":
            texto = str(args.get("instrucciones", "")).strip()[:4000]
            if len(texto) < 20:
                raise ValueError("Las instrucciones nuevas son demasiado cortas")
            return {"descripcion": f"Nuevas instrucciones para {nombre} (desde los próximos videos).",
                    "texto_completo": texto, "config": {destino: {"instrucciones": texto}}}
        alcance = str(args.get("alcance") or ("video" if plan else "siempre"))
        if alcance not in {"video", "siempre"}:
            raise ValueError("El alcance debe ser «video» o «siempre»")
        if alcance == "video" and not plan:
            raise ValueError("Elige un video arriba para cambiar solo ese video")
        en_video = (plan or {}).get("skills", {}).get(destino) if plan else None
        donde = " (solo en este video)" if alcance == "video" else \
            (" (desde ahora en todos los videos y en este)" if plan else " (desde ahora en todos los videos)")
        if herramienta == "activar":
            if not isinstance(args.get("activa"), bool):
                raise ValueError("Di si la skill queda activa o apagada")
            cambio = {"activa": args["activa"]}
            descripcion = f"{'Activar' if args['activa'] else 'Apagar'} {nombre}{donde}."
        else:
            recursos = [{"id": r["id"], "tipo": r["tipo"]} for r in guardada["recursos_cargados"]]
            esquema = {"parametros": base["parametros"], "recursos": recursos, "nombre": nombre}
            ajustes = motor.validar_ajustes(esquema, args.get("ajustes") if isinstance(args.get("ajustes"), dict) else {})
            if not ajustes:
                raise ValueError("No dijiste qué ajuste cambiar")
            antes = (en_video or guardada)["ajustes"]
            vista = {**esquema, "recursos": [{"id": r["id"], "nombre": r["nombre"]} for r in guardada["recursos_cargados"]]}
            partes = [f"{motor.resumen_ajuste(vista, k, antes.get(k))} → {motor.resumen_ajuste(vista, k, v).split(': ', 1)[1]}"
                      for k, v in ajustes.items()]
            cambio = {"ajustes": ajustes}
            descripcion = f"{nombre} · {'; '.join(partes)}{donde}."
        return {"descripcion": descripcion, "cambios": {"skills": {destino: cambio}} if plan else {},
                "config": {destino: cambio} if alcance == "siempre" else {}}

    def _juntar(self, traducidas: list[dict], contexto: dict) -> tuple[dict, dict]:
        cambios, config = {}, {}
        for t in traducidas:
            _sumar(cambios, t.get("cambios") or {})
            for destino, cambio in (t.get("config") or {}).items():
                actual = config.setdefault(destino, {})
                actual.update({k: v for k, v in cambio.items() if k != "ajustes"})
                if "ajustes" in cambio:
                    actual.setdefault("ajustes", {}).update(cambio["ajustes"])
        if contexto["plan"] and not contexto["plan"].get("skills") and "skills" in cambios:
            cambios["skills_base"] = self.skills.para_motor()
        return cambios, config

    # --- Lo que la skill sabe -----------------------------------------------------------------

    def _contexto(self, edit_id: str) -> dict:
        if not edit_id:
            return {"edit_id": "", "plan": None, "vista": None, "project_id": ""}
        vista = self.semantic.vista(edit_id)
        return {"edit_id": edit_id, "plan": self.semantic.leer_plan(edit_id), "vista": vista, "project_id": vista["project_id"]}

    def _prompt(self, skill_id: str, edit_id: str, contexto: dict) -> str:
        skill = self.skills.obtener(skill_id)
        plan = contexto["plan"]
        en_video = (plan or {}).get("skills", {}).get(skill_id) or {}
        ajustes = en_video.get("ajustes") or skill["ajustes"]
        lineas_ajustes = []
        for p in skill["parametros"]:
            permitido = (f"{p['min']}–{p['max']}{p.get('unidad', '')}" if p["tipo"] == "rango"
                         else "|".join(o[0] for o in p["opciones"]) if p["tipo"] in {"opcion", "multiple"}
                         else "true|false" if p["tipo"] == "bool" else "id de un recurso cargado o vacío" if p["tipo"] == "recurso"
                         else f"texto de hasta {p.get('max', 120)} caracteres")
            lineas_ajustes.append(f"- {p['clave']} = {json.dumps(ajustes.get(p['clave']), ensure_ascii=False)} "
                                  f"({p['etiqueta']}; permitido: {permitido})")
        recursos = [f"- {r['id']}: {r['nombre']} ({r['tipo_nombre']})" for r in skill["recursos_cargados"]]
        documentos = " ".join(r.get("texto", "") for r in self.skills.para_motor()["skills"][skill_id]["recursos"]
                              if r["tipo"] == "document")[:3000]
        herramientas = "\n".join(f"- {h}: {HERRAMIENTAS[h][0]} args: {HERRAMIENTAS[h][1]}" for h in POR_SKILL[skill_id])
        if skill_id == "director":
            otras = "\n".join(f"- {s['id']}: {s['nombre']} ({'activa' if s['activa'] else 'apagada'}"
                              f"{'' if s['director_ajusta'] else ', bloqueada para el Director'}). {s['descripcion']}"
                              for s in self.skills.listar() if s["id"] != "director")
            papel = f"Eres el Director: orquestas todas las skills y puedes usar cualquiera de sus herramientas.\nSkills:\n{otras}"
        else:
            papel = (f"Tu trabajo: {skill['descripcion']} Si te piden algo que hace otra skill, dilo y sugiere cuál "
                     "(Efectos visuales, Recortes, Edición y ritmo, Sonido, Efectos de audio, Subtítulos, Filtros, Retoques, "
                     "Superposiciones, Generador de imágenes o el Director).")
        return f"""Eres «{skill['nombre']}», una skill de edición de Kiko Studio, la plataforma con que se editan los videos
verticales de Kiko Orator (reflexiones, fe y motivación, en español). Hablas con quien edita sus videos: en español,
de tú, breve y concreto. {papel}

Tus instrucciones (síguelas siempre):
{skill['instrucciones']}

Tus ajustes{' en este video' if en_video else ''}:
{chr(10).join(lineas_ajustes) or '- (sin ajustes)'}
{('Tus recursos cargados:' + chr(10) + chr(10).join(recursos) + chr(10)) if recursos else ''}{('Conocimiento que te cargaron: ' + documentos + chr(10)) if documentos else ''}
{self._contexto_video(skill_id, contexto) if plan else 'No hay un video abierto: solo puedes hablar de tu configuración y cambiarla con alcance «siempre».'}

Herramientas que puedes usar (solo estas):
{herramientas}

Reglas:
- Si te preguntan algo, responde sin acciones. Si te piden un cambio, propón las acciones exactas: quien edita las revisa
  y las aplica con un botón. Nunca digas que ya lo hiciste: di qué propones.
- Las frases van tal como se dicen en el video: cópialas de la transcripción. Los ids, de las listas de este mensaje.
- No inventes íconos, países ni imágenes: solo íconos Tabler outline que existan e imágenes de la biblioteca.
- Si algo no se puede con tus herramientas, dilo con honestidad.
- Máximo {MAX_ACCIONES} acciones por respuesta.

Conversación hasta ahora:
{self._historial(skill_id, edit_id)}

Responde SOLO con JSON válido, sin texto adicional:
{{"respuesta": "lo que le dices a quien edita", "acciones": [{{"herramienta": "...", "args": {{}}}}]}}"""

    def _historial(self, skill_id: str, edit_id: str) -> str:
        with self.store.lock:
            filas = self.store.connection.execute(
                "SELECT * FROM skill_chat WHERE skill_id=? AND edit_id=? AND estado!='pensando' ORDER BY created_at DESC, rowid DESC LIMIT ?",
                (skill_id, edit_id, HISTORIAL),
            ).fetchall()
        lineas = []
        for fila in reversed([self._mensaje(dict(f)) for f in filas]):
            if fila["rol"] == "usuario":
                lineas.append(f"Quien edita: {fila['texto']}")
                continue
            propuestas = "; ".join(a["descripcion"] for a in fila["acciones"] if a.get("valida"))
            estado = {"aplicada": "aplicadas", "deshecha": "aplicadas y luego deshechas", "lista": "sin aplicar todavía"}.get(fila["estado"], "")
            lineas.append(f"Tú: {fila['texto']}" + (f" [Propuestas: {propuestas} — {estado}]" if propuestas else ""))
        return "\n".join(lineas)

    def _contexto_video(self, skill_id: str, contexto: dict) -> str:
        plan, vista = contexto["plan"], contexto["vista"]
        partes = [f"Video «{vista['name']}»: dura {_s(plan['duracion'])} s (las tomas suman {_s(vista.get('duracion_original', 0))} s). "
                  f"Montaje: {plan['montaje'].get('eleccion') or 'automático'}."]
        if plan.get("objetivo"):
            partes.append(f"Objetivo del video: {plan['objetivo']}")
        partes.append("Lo que se dice en el video (segundo: frase):\n" + self._transcripcion(plan))
        todo = skill_id == "director"
        if todo or skill_id in {"efectos", "generador", "audio_fx"}:
            graficos = [f"- {e['id']} · {e['nombre']} · {_s(e['inicio'])}–{_s(e['fin'])} s · dice «{e['dice']}»"
                        + (f" · texto «{e['texto']}»" if e.get("texto") else "") + (f" · sonido {e['sonido']}" if e.get("sonido") else " · sin sonido")
                        + (f" · verificar: {e['verificar']}" if e.get("verificar") else "") for e in vista["eventos"]]
            partes.append("Gráficos, imágenes y sonidos del video:\n" + ("\n".join(graficos) or "- ninguno"))
            descartados = [f"- {_s(d.get('inicio', 0))} s · {NOMBRES.get(d['componente'], d['componente'])} «{d.get('ancla', '')}»: {d['motivo']}"
                           for d in vista["descartados"][-12:]]
            if descartados:
                partes.append("Lo que se descartó y por qué:\n" + "\n".join(descartados))
        if todo or skill_id == "generador":
            imagenes = [r["nombre"] for r in self.biblioteca(contexto["project_id"]) if r["tipo"] in {"image", "logo"}]
            partes.append("Imágenes en la biblioteca del proyecto: " + (", ".join(imagenes[:40]) or "ninguna todavía"))
            avisos = (vista.get("libreto") or {}).get("avisos") or []
            if avisos:
                partes.append("Avisos del libreto: " + " ".join(avisos[:6]))
        if todo or skill_id == "recortes":
            montaje = vista["montaje"]
            partes.append("Tramos del montaje:\n" + "\n".join(
                f"- {_s(t['salida'])} s (toma {t['toma']}, {_s(t['desde'])}–{_s(t['hasta'])} s): «{t['texto']}»" for t in montaje["tramos"]))
            fuera = [f"- {_s(r['desde'])}–{_s(r['hasta'])} s de la toma: «{r['texto']}»" for r in montaje["eliminados"][:20]]
            if fuera:
                partes.append("Lo que quedó cortado:\n" + "\n".join(fuera))
            if vista.get("opciones_montaje"):
                partes.append("Montajes sugeridos: " + "; ".join(f"{k} = {v}" for k, v in vista["opciones_montaje"].items()))
            guia = vista.get("libreto")
            if guia:
                partes.append(f"Libreto: {round(guia['cobertura'] * 100)} % cubierto; faltan {len(guia['faltan'])} líneas; "
                              f"{len(guia['repetidas'])} líneas repetidas.")
        if todo or skill_id == "edicion":
            partes.append("Acercamientos de cámara:\n" + "\n".join(
                f"- {_s(z['inicio'])} s: {z['motivo']}" + (f" (id {z['id']})" if z.get("id") else "") for z in plan["camara"]["zoom"]))
        if todo or skill_id == "subtitulos":
            correcciones = [f"- «{c['de']}» → «{c['a']}» ({c.get('fuente', '')})" for c in plan.get("correcciones", [])[-15:]]
            if correcciones:
                partes.append("Correcciones de transcripción hechas:\n" + "\n".join(correcciones))
        hechos = (plan.get("director") or {}).get("hechos") or {}
        if hechos and (todo or skill_id in {"sonido", "filtros", "retoques", "subtitulos", "edicion"}):
            partes.append("Lo que midió el Director en la toma: " + "; ".join(hechos.get("observaciones", []))
                          + f". Imagen: {json.dumps(hechos.get('imagen', {}))}. Audio: {json.dumps(hechos.get('audio', {}))}.")
        if todo and plan.get("director"):
            recs = [f"- {r['skill']}: {'usar' if r.get('usar') else 'no usar'} · {r.get('motivo', '')} · ajustes {json.dumps(r.get('ajustes', {}), ensure_ascii=False)}"
                    + (" (ya aplicada)" if r["skill"] in plan["director"].get("aplicadas", []) else "")
                    for r in plan["director"].get("recomendaciones", [])]
            partes.append("Tus recomendaciones para este video:\n" + ("\n".join(recs) or "- ninguna"))
        return "\n\n".join(partes)

    @staticmethod
    def _transcripcion(plan: dict) -> str:
        frases, actual, inicio = [], [], 0.0
        for p in plan["palabras"]:
            if not actual:
                inicio = p["inicio"]
            actual.append(p["texto"])
            if p["texto"].endswith((".", "?", "!", "…")) or len(actual) >= 16:
                frases.append(f"[{_s(inicio)}] {' '.join(actual)}")
                actual = []
        if actual:
            frases.append(f"[{_s(inicio)}] {' '.join(actual)}")
        texto = "\n".join(frases)
        return texto if len(texto) <= 7000 else texto[:7000] + "…"

    # --- Base de datos ------------------------------------------------------------------------

    def _skill(self, skill_id: str) -> str:
        if skill_id not in POR_SKILL:
            raise ValueError("La skill no existe")
        return skill_id

    def _insertar(self, skill_id: str, edit_id: str, rol: str, texto: str, estado: str) -> str:
        mensaje_id = str(uuid4())
        with self.store.transaction(immediate=True) as con:
            con.execute("INSERT INTO skill_chat(id,skill_id,edit_id,rol,texto,estado,created_at) VALUES(?,?,?,?,?,?,?)",
                        (mensaje_id, skill_id, edit_id, rol, texto, estado, _ahora()))
        return mensaje_id

    def _actualizar(self, mensaje_id: str, **campos) -> None:
        for clave in ("acciones", "detalle"):
            if clave in campos:
                campos[clave] = json.dumps(campos[clave], ensure_ascii=False)
        asignaciones = ", ".join(f"{clave}=?" for clave in campos)
        with self.store.transaction(immediate=True) as con:
            con.execute(f"UPDATE skill_chat SET {asignaciones} WHERE id=?", (*campos.values(), mensaje_id))

    def _fila(self, mensaje_id: str) -> dict:
        with self.store.lock:
            fila = self.store.connection.execute("SELECT * FROM skill_chat WHERE id=?", (mensaje_id,)).fetchone()
        if not fila:
            raise ValueError("El mensaje no existe")
        return self._mensaje(dict(fila))

    @staticmethod
    def _mensaje(fila: dict) -> dict:
        fila["acciones"] = json.loads(fila.get("acciones") or "[]")
        fila["detalle"] = json.loads(fila.get("detalle") or "{}")
        return fila
