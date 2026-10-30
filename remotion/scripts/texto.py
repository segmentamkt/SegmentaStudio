"""Normalización de palabras compartida por el planificador, los subtítulos y el control de calidad."""

from __future__ import annotations

import re
import unicodedata

# Palabras que no cierran una tarjeta de subtítulos ni se ilustran.
FUNCIONALES = {
    "a", "al", "de", "del", "el", "la", "lo", "los", "las", "un", "una", "unos", "unas", "y", "e", "o", "u",
    "que", "en", "por", "para", "tu", "te", "mi", "me", "se", "con", "su", "sus", "es", "era", "le", "les",
    "nos", "ni", "si", "como", "pero", "mas", "muy", "ya", "hay", "fue", "son", "sin", "sobre", "entre",
}


def normalizar_palabra(texto: str) -> str:
    sin_tildes = unicodedata.normalize("NFD", texto.lower())
    return re.sub(r"[^a-zñ0-9]", "", "".join(c for c in sin_tildes if unicodedata.category(c) != "Mn"))


def es_mayuscula(texto: str) -> bool:
    limpio = texto.lstrip("¿¡\"'«(")
    return bool(limpio) and limpio[0].isupper()


def cierra_oracion(texto: str) -> bool:
    return texto.rstrip("\"'»)").endswith((".", "?", "!", "…", ":"))
