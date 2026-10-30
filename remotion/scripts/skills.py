"""Skills de edición: lectura y validación de sus ajustes (las usa el motor y también Kiko Studio).

Kiko Studio guarda el catálogo (instrucciones, ajustes, recursos) y entrega al motor una copia por plan en
`skills.json`: {"skills": {id: {"nombre", "activa", "instrucciones", "ajustes", "director_ajusta",
"parametros": [esquema], "recursos": [{"id", "nombre", "tipo", "ruta", "licencia", "texto"}]}}}.
Sin ese archivo (uso por terminal) el motor trabaja con sus valores de siempre.

Tipos de parámetro: bool · rango (min, max, paso) · opcion (opciones [[valor, etiqueta]]) ·
multiple (subconjunto de opciones) · color (#RRGGBB) · texto (max) · recurso (id de un recurso del tipo
`recurso_tipo` de la misma skill, o "" para el valor por defecto).
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


def cargar(ruta: Path | None) -> dict[str, dict]:
    if not ruta:
        return {}
    datos = json.loads(Path(ruta).read_text(encoding="utf-8"))
    return datos.get("skills", datos)


def cargar_dict(datos: dict) -> dict[str, dict]:
    return datos.get("skills", datos)


def activa(skills: dict, skill: str) -> bool:
    """Una skill que no viene en el plan cuenta como activa: así el uso por terminal no cambia."""
    return bool(skills.get(skill, {}).get("activa", True))


def ajuste(skills: dict, skill: str, clave: str, defecto: Any) -> Any:
    valor = skills.get(skill, {}).get("ajustes", {}).get(clave)
    return defecto if valor is None else valor


def recurso(skills: dict, skill: str, clave: str) -> dict | None:
    """El recurso elegido en un parámetro de tipo «recurso», o None si se dejó el valor por defecto."""
    elegido = ajuste(skills, skill, clave, "")
    return next((r for r in skills.get(skill, {}).get("recursos", []) if r["id"] == elegido), None) if elegido else None


def validar_valor(parametro: dict, valor: Any, recursos: list[dict]) -> Any:
    """Devuelve el valor ya normalizado o lanza ValueError con un mensaje para el panel."""
    tipo, etiqueta = parametro["tipo"], parametro.get("etiqueta", parametro["clave"])
    if tipo == "bool":
        if not isinstance(valor, bool):
            raise ValueError(f"«{etiqueta}» debe ser sí o no")
        return valor
    if tipo == "rango":
        try:
            numero = float(valor)
        except (TypeError, ValueError):
            raise ValueError(f"«{etiqueta}» debe ser un número") from None
        numero = max(parametro["min"], min(parametro["max"], numero))
        paso = parametro.get("paso", 1)
        numero = round(round(numero / paso) * paso, 4)
        return int(numero) if float(paso).is_integer() and float(numero).is_integer() else numero
    if tipo == "opcion":
        if valor not in [o[0] for o in parametro["opciones"]]:
            raise ValueError(f"«{valor}» no es una opción de «{etiqueta}»")
        return valor
    if tipo == "multiple":
        validas = [o[0] for o in parametro["opciones"]]
        if not isinstance(valor, list) or any(v not in validas for v in valor):
            raise ValueError(f"Opciones no válidas en «{etiqueta}»")
        return [v for v in validas if v in valor]
    if tipo == "color":
        if not isinstance(valor, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", valor):
            raise ValueError(f"«{etiqueta}» debe ser un color #RRGGBB")
        return valor.upper()
    if tipo == "texto":
        return " ".join(str(valor or "").split())[: parametro.get("max", 120)]
    if tipo == "recurso":
        if valor in ("", None):
            return ""
        if not any(r["id"] == valor and r["tipo"] == parametro["recurso_tipo"] for r in recursos):
            raise ValueError(f"El recurso elegido en «{etiqueta}» no existe en esta skill")
        return valor
    raise ValueError(f"Tipo de parámetro desconocido: {tipo}")


def validar_ajustes(skill: dict, ajustes: dict, *, estricto: bool = True) -> dict:
    """Ajustes válidos según el esquema de la skill. Con estricto=False se ignoran (no fallan) los inválidos:
    así se filtran las propuestas de la IA sin descartar las que sí sirven."""
    esquema = {p["clave"]: p for p in skill.get("parametros", [])}
    limpios = {}
    for clave, valor in (ajustes or {}).items():
        if clave not in esquema:
            if estricto:
                raise ValueError(f"«{clave}» no es un ajuste de {skill.get('nombre', 'esta skill')}")
            continue
        try:
            limpios[clave] = validar_valor(esquema[clave], valor, skill.get("recursos", []))
        except ValueError:
            if estricto:
                raise
    return limpios


def aplicar(skills: dict, cambios: dict) -> dict:
    """{skill: {"activa": bool, "ajustes": {...}}} sobre una copia de las skills del plan."""
    nuevas = json.loads(json.dumps(skills))
    for skill_id, cambio in (cambios or {}).items():
        if skill_id not in nuevas:
            raise ValueError(f"La skill «{skill_id}» no existe")
        if "activa" in cambio:
            if not isinstance(cambio["activa"], bool):
                raise ValueError("«activa» debe ser sí o no")
            nuevas[skill_id]["activa"] = cambio["activa"]
        nuevas[skill_id]["ajustes"].update(validar_ajustes(nuevas[skill_id], cambio.get("ajustes", {})))
    return nuevas


def resumen_ajuste(skill: dict, clave: str, valor: Any) -> str:
    """«Preset: Cálido» — para mostrar recomendaciones y el plan en lenguaje del panel."""
    parametro = next((p for p in skill.get("parametros", []) if p["clave"] == clave), {"etiqueta": clave, "tipo": ""})
    if parametro["tipo"] == "bool":
        texto = "sí" if valor else "no"
    elif parametro["tipo"] in {"opcion", "multiple"}:
        nombres = dict(parametro["opciones"])
        texto = ", ".join(nombres.get(v, v) for v in valor) if isinstance(valor, list) else nombres.get(valor, valor)
    elif parametro["tipo"] == "recurso":
        texto = next((r["nombre"] for r in skill.get("recursos", []) if r["id"] == valor), "por defecto")
    else:
        texto = f"{valor}{parametro.get('unidad', '')}".replace(".", ",") if isinstance(valor, (int, float)) \
            else f"{valor}{parametro.get('unidad', '')}"
    return f"{parametro['etiqueta']}: {texto}"
