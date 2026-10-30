"""Tarjetas de subtítulos de 2–4 palabras cortadas por grupo sintáctico."""

from __future__ import annotations

import re

from texto import FUNCIONALES, normalizar_palabra


def tarjetas_subtitulos(palabras: list[dict], fin_total: float, claves: set[int], finales: set[int] | None = None,
                        *, mayusculas: bool = True) -> list[dict]:
    """Nunca cierra una tarjeta en palabra funcional ni parte «X de Y».

    Resalta todas las palabras de `claves`, pero solo corta después de la última palabra de cada ancla
    (`finales`), para no partir «inteligencia | artificial».
    """
    finales = claves if finales is None else finales
    tarjetas, actual = [], []
    for indice, palabra in enumerate(palabras):
        actual.append(palabra)
        siguiente = palabras[indice + 1] if indice + 1 < len(palabras) else None
        if siguiente is None:
            tarjetas.append(actual)
            break
        nombre, proxima = normalizar_palabra(palabra["texto"]), normalizar_palabra(siguiente["texto"])
        funcional = nombre in FUNCIONALES
        complemento = proxima in {"de", "del"}
        dentro_de_ancla = palabra["i"] in claves and palabra["i"] not in finales
        pausa = palabra["texto"][-1] in ",.;:!?…" or siguiente["inicio"] - palabra["fin"] > 0.35
        natural = not dentro_de_ancla and (
            (palabra["i"] in finales and not complemento)
            or (len(actual) >= 2 and not funcional and proxima in FUNCIONALES and not complemento)
            or (len(actual) >= 4 and not funcional)
        )
        if pausa or natural:
            tarjetas.append(actual)
            actual = []
        elif len(actual) >= 5 and not dentro_de_ancla:
            # Larga y terminando en palabra funcional («¿sabe qué fue lo que…»): se corta en la última palabra
            # con contenido y las funcionales pasan a abrir la tarjeta siguiente.
            ultima = max((k for k, p in enumerate(actual) if normalizar_palabra(p["texto"]) not in FUNCIONALES), default=0)
            if ultima >= 1:
                tarjetas.append(actual[:ultima + 1])
                actual = actual[ultima + 1:]
            elif len(actual) >= 7:
                tarjetas.append(actual)
                actual = []
    resultado = []
    for indice, grupo in enumerate(tarjetas):
        fin = tarjetas[indice + 1][0]["inicio"] if indice + 1 < len(tarjetas) else min(fin_total, grupo[-1]["fin"] + 0.35)
        resultado.append({
            "inicio": grupo[0]["inicio"],
            "fin": max(fin, grupo[0]["inicio"] + 0.4),
            "palabras": [{
                "texto": re.sub(r"[,.;:…]+$", "", p["texto"]).upper() if mayusculas else re.sub(r"[,.;:…]+$", "", p["texto"]),
                "inicio": p["inicio"],
                "clave": p["i"] in claves,
            } for p in grupo],
        })
    return resultado


def cortes_sintacticos_malos(tarjetas: list[dict]) -> list[str]:
    return [
        " ".join(p["texto"] for p in tarjeta["palabras"]) for tarjeta in tarjetas
        if len(tarjeta["palabras"]) > 1 and normalizar_palabra(tarjeta["palabras"][-1]["texto"]) in FUNCIONALES
    ]
