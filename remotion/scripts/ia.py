"""Pase semántico opcional con Claude, Codex o Gemini mediante MultiAgent Core (sesiones autorizadas, sin claves API).

La IA solo propone. Cada propuesta se valida aquí: índices de palabras reales, componentes del catálogo,
países de Natural Earth, íconos Tabler existentes, textos tomados literalmente de la transcripción y
correcciones ortográficas cercanas a lo transcrito. Lo que no pasa la validación se descarta con su motivo.
"""

from __future__ import annotations

import difflib
import json
import re
import sys
import time
from pathlib import Path
from typing import Optional

from planificador import CATALOGO, Candidato, Palabra, cargar_paises, icono_svg
from texto import es_mayuscula, normalizar_palabra

RAIZ = Path(__file__).resolve().parents[1]
KIKO = RAIZ.parent
if str(KIKO) not in sys.path:
    sys.path.insert(0, str(KIKO))

PREFERENCIA = ("claude-cli", "codex-cli", "gemini-cli")

REGLAS = """\
- Interpreta lo que se dice, no cada palabra: un gráfico por idea, nunca una imagen por palabra.
- Lugares solo en contexto geográfico. Si se menciona un equipo o persona real, no afirmes hechos: marca "verificar".
- «Teclado» o «escribir» con objeto explícito → teclado; teclado musical → icono "piano".
- «Moneda» con lanzar/cara o sello → moneda; si es dinero o precio → icono "coins".
- «Me llamaron», «teléfono» → llamada; «me llamo Ana» es un nombre, no una llamada.
- Inteligencia artificial → icono "cpu"; nunca robots genéricos.
- Conceptos abstractos: mejor nada (queda la cara) o texto_cinetico con las palabras dichas.
- Política, economía y cifras: nunca inventes datos; marca "verificar".
- No inventes tiempos, textos, cifras ni recursos: solo eliges rangos de palabras (i0, i1) y parámetros del catálogo."""


def _proveedor(preferido: str):
    from multiagent_core.providers import detect_cli_providers

    gemini = KIKO / ".tools" / "gemini" / "node_modules" / ".bin" / "gemini"
    disponibles = {p.name: p for p in detect_cli_providers(
        executables={"gemini": str(gemini)} if gemini.exists() else None, timeout_seconds=240,
    )}
    orden = PREFERENCIA if preferido == "auto" else (f"{preferido}-cli",)
    return next((disponibles[nombre] for nombre in orden if nombre in disponibles), None), sorted(disponibles)


def _prompt(palabras: list[Palabra], candidatos: list[Candidato], libreto: str | None = None,
            director: str | None = None) -> str:
    transcripcion = " ".join(f"{p.i}:{p.texto}" for p in palabras)
    locales = [{"id": c.id, "componente": c.componente, "i0": c.i0, "i1": c.i1,
                "params": {k: v for k, v in c.params.items() if not k.startswith("_") and k != "svg"}} for c in candidatos]
    catalogo = "\n".join(f"- {nombre}: {descripcion}" for nombre, descripcion in CATALOGO.items())
    return f"""Eres el director de edición de videos verticales hablados en español.
Recibes la transcripción con índices de palabra y los candidatos que encontró el análisis local.
Propón eventos visuales semánticos que falten, descarta candidatos locales equivocados y corrige errores
evidentes de transcripción (nombres propios o marcas mal escritos).

Reglas:
{REGLAS}

Catálogo de componentes (params obligatorios):
{catalogo}
- mapa_pais: {{"pais": código ADM0_A3 de Natural Earth}}
- icono: {{"icono": nombre de ícono Tabler outline, por ejemplo "plane", "cash", "school"}}
- trofeo, teclado, llamada, moneda, texto_cinetico: {{}}

{"Libreto (lo que debía decirse; úsalo para entender la intención, las indicaciones entre corchetes ya se aplican aparte):" + chr(10) + libreto[:6000] + chr(10) + chr(10) if libreto else ""}Transcripción:
{transcripcion}

Candidatos locales:
{json.dumps(locales, ensure_ascii=False)}
{director or ""}

Responde SOLO con JSON válido, sin texto adicional:
{{"eventos": [{{"componente": "...", "i0": 0, "i1": 0, "params": {{}}, "justificacion": "...", "verificar": null}}],
  "descartar": [{{"id": "c0", "motivo": "..."}}],
  "correcciones": [{{"i": 0, "a": "...", "motivo": "..."}}]}}"""


def _extraer_json(texto: str) -> dict:
    bloque = re.search(r"\{.*\}", texto, re.S)
    if not bloque:
        raise ValueError("la respuesta no contiene JSON")
    return json.loads(bloque.group(0))


def validar(respuesta: dict, palabras: list[Palabra], candidatos: list[Candidato], fuente: str):
    """Convierte la respuesta en candidatos, descartes y correcciones válidos; lo demás se reporta."""
    _, oficiales = cargar_paises()
    nuevos: list[Candidato] = []
    rechazos: list[dict] = []
    total = len(palabras)

    for numero, propuesta in enumerate(respuesta.get("eventos", [])):
        componente = propuesta.get("componente")
        i0, i1 = propuesta.get("i0"), propuesta.get("i1", propuesta.get("i0"))
        params = dict(propuesta.get("params") or {})
        motivo: Optional[str] = None
        if componente not in CATALOGO:
            motivo = f"componente desconocido «{componente}»"
        elif not (isinstance(i0, int) and isinstance(i1, int) and 0 <= i0 <= i1 < total and i1 - i0 <= 5):
            motivo = f"índices de palabra inválidos ({i0}, {i1})"
        elif componente == "mapa_pais" and (params.get("pais") not in oficiales or not es_mayuscula(palabras[i0].texto)):
            motivo = f"país «{params.get('pais')}» no está en Natural Earth o la palabra no es un nombre propio"
        elif componente == "icono" and not icono_svg(str(params.get("icono", ""))):
            motivo = f"el ícono «{params.get('icono')}» no existe en Tabler"
        if motivo:
            rechazos.append({"componente": componente, "ancla": "", "inicio": palabras[i0].inicio if isinstance(i0, int) and 0 <= i0 < total else 0,
                             "fuente": fuente, "motivo": f"Propuesta de IA rechazada: {motivo}."})
            continue
        dicho = " ".join(p.texto for p in palabras[i0:i1 + 1])
        limpio = re.sub(r"[,.;:!?…]+$", "", dicho)
        # Los textos visibles siempre salen de lo dicho, nunca de la IA.
        if componente == "mapa_pais":
            params = {"pais": params["pais"], "nombre": oficiales[params["pais"]]}
        elif componente == "icono":
            params = {"icono": params["icono"]}
        elif componente == "trofeo":
            params = {"texto": f"¡{limpio.upper()}!"}
        elif componente == "texto_cinetico":
            params = {"texto": limpio.upper(), "estilo": "concepto"}
        elif componente == "llamada":
            params = {"nombre": "Contacto", "contesta": round(palabras[i1].fin + 1.2, 3)}
        elif componente == "moneda":
            params = {"aterriza": palabras[i1].fin}
        elif componente == "teclado":
            params = {"escritura_i": None}
        nuevos.append(Candidato(
            componente, i0, i1, params, str(propuesta.get("justificacion", "Propuesta de IA."))[:300],
            fuente=fuente, verificar=(str(propuesta["verificar"])[:300] if propuesta.get("verificar") else None),
            clave=f"{componente}:{params.get('pais') or params.get('icono') or normalizar_palabra(limpio)}", id=f"ia{numero}",
        ))

    ids = {c.id: c for c in candidatos}
    descartes = [(ids[d["id"]], str(d.get("motivo", ""))[:300]) for d in respuesta.get("descartar", []) if d.get("id") in ids]

    correcciones = []
    for propuesta in respuesta.get("correcciones", []):
        i, nuevo = propuesta.get("i"), re.sub(r"[,.;:!?…]+$", "", str(propuesta.get("a", "")).strip())
        if not (isinstance(i, int) and 0 <= i < total and nuevo):
            continue
        original = re.sub(r"[,.;:!?…]+$", "", palabras[i].texto)
        cola = palabras[i].texto[len(original):]
        parecido = difflib.SequenceMatcher(None, normalizar_palabra(original), normalizar_palabra(nuevo)).ratio()
        if parecido >= 0.6 and nuevo != original and len(nuevo.split()) <= 2:
            correcciones.append({"i": i, "de": palabras[i].texto, "a": nuevo + cola, "fuente": fuente,
                                 "motivo": str(propuesta.get("motivo", ""))[:200]})
    return nuevos, descartes, correcciones, rechazos


def proponer(palabras: list[Palabra], candidatos: list[Candidato], preferido: str = "auto", libreto: str | None = None,
             director: str | None = None):
    """Devuelve (nuevos, descartes, correcciones, rechazos, info). Si no hay IA, todo vacío con el motivo.

    Con `director` (la sección de director.seccion_prompt) la misma consulta recomienda skills; la respuesta
    cruda queda en info["director"] y la valida director.validar.
    """
    if preferido == "no":
        return [], [], [], [], {"estado": "desactivada"}
    try:
        proveedor, disponibles = _proveedor(preferido)
    except Exception as exc:  # MultiAgent Core ausente o roto: el plan local sigue siendo válido.
        return [], [], [], [], {"estado": f"no disponible ({exc})"}
    if proveedor is None:
        return [], [], [], [], {"estado": "no disponible", "detectados": disponibles}
    inicio = time.time()
    try:
        resultado = proveedor.generate(_prompt(palabras, candidatos, libreto, director))
        respuesta = _extraer_json(resultado.content)
    except Exception as exc:
        return [], [], [], [], {"estado": f"falló ({str(exc)[:200]})", "proveedor": proveedor.name}
    nuevos, descartes, correcciones, rechazos = validar(respuesta, palabras, candidatos, f"ia:{proveedor.name}")
    return nuevos, descartes, correcciones, rechazos, {
        "estado": "usada", "proveedor": proveedor.name, "segundos": round(time.time() - inicio, 1),
        "propuestos": len(respuesta.get("eventos", [])), "aceptados": len(nuevos), "rechazados": len(rechazos),
        **({"director": respuesta.get("director")} if director else {}),
    }
