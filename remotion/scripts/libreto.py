"""Libreto: la referencia de lo que debía decirse en la toma.

Se alinea con la transcripción por palabra para:
- corregir la escritura con el libreto (ortografía, nombres propios, puntuación), sin adivinar;
- recuperar palabras que el reconocimiento se comió (se muestran pegadas a la palabra vecina);
- elegir, para cada línea, la toma completa más reciente: resuelve repeticiones y varias tomas;
- avisar de las líneas que faltan y de lo que se dijo fuera del libreto;
- convertir las indicaciones entre corchetes en eventos del plan.

Indicaciones (al final o en medio de una línea; mayúsculas o minúsculas):
    [IMAGEN biblia.png]   imagen de tu biblioteca de recursos · [IMAGEN biblia.png "Biblia antigua, luz de vela"]
                          describe cómo generarla con IA si todavía no la tienes
    [TEXTO]               la línea en grande · [TEXTO "MATEO 25"] un texto propio
    [MAPA Brasil]         mapa con el país resaltado
    [ICONO plane]         ícono Tabler por nombre
    [SONIDO golpe.wav]    sonido de tu biblioteca al empezar la línea
    [SIN GRÁFICO]         nada automático en esta línea
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field
from typing import Optional

from texto import normalizar_palabra

INDICACION = re.compile(r"\[([^\]]+)\]")
NOMBRE_Y_DESCRIPCION = re.compile(r'^(\S+)\s+["“«](.+?)["”»]?$')
TIPOS = {"imagen": "imagen", "texto": "texto", "mapa": "mapa", "icono": "icono", "sonido": "sonido",
         "sin grafico": "sin_grafico", "singrafico": "sin_grafico"}
COBERTURA_MINIMA = 0.5   # una línea cuenta como dicha si coincide al menos la mitad de sus palabras
CASI_COMPLETA = 0.15     # entre tomas «casi igual de completas» gana la más reciente
FUERA_MINIMO = 3         # menos palabras fuera del libreto se consideran tropiezos, no improvisación
HUECO_SIN_CORTE = 2      # hasta 2 palabras sueltas entre dos líneas de la misma toma se dejan: un corte ahí salta
EXCESO_FUSION = 0.35     # una palabra que dura esto de más probablemente se tragó a la siguiente

_NUMEROS = {
    "cero": "0", "uno": "1", "una": "1", "dos": "2", "tres": "3", "cuatro": "4", "cinco": "5", "seis": "6",
    "siete": "7", "ocho": "8", "nueve": "9", "diez": "10", "once": "11", "doce": "12", "trece": "13",
    "catorce": "14", "quince": "15", "dieciseis": "16", "diecisiete": "17", "dieciocho": "18",
    "diecinueve": "19", "veinte": "20", "veintiuno": "21", "veintidos": "22", "veintitres": "23",
    "veinticuatro": "24", "veinticinco": "25", "veintiseis": "26", "veintisiete": "27", "veintiocho": "28",
    "veintinueve": "29", "treinta": "30", "cuarenta": "40", "cincuenta": "50", "sesenta": "60",
    "setenta": "70", "ochenta": "80", "noventa": "90", "cien": "100", "mil": "1000",
}


def canonico(token: str) -> str:
    """«veinticinco» y «25» cuentan como la misma palabra; el reconocimiento usa una u otra."""
    return _NUMEROS.get(token, token)


def parecidas(a: str, b: str) -> bool:
    if a == b:
        return True
    return len(a) >= 4 and len(b) >= 4 and difflib.SequenceMatcher(None, a, b).ratio() >= 0.8


@dataclass
class Linea:
    n: int
    texto: str
    palabras: list[str]
    normales: list[str]
    indicaciones: list[dict] = field(default_factory=list)


def leer(texto: str) -> list[Linea]:
    """Una línea del libreto por renglón; las vacías y las que empiezan con # se ignoran."""
    lineas = []
    for renglon in texto.splitlines():
        renglon = renglon.strip()
        if not renglon or renglon.startswith("#"):
            continue
        indicaciones = []
        for contenido in INDICACION.findall(renglon):
            partes = contenido.strip().split(None, 1)
            clave = normalizar_palabra(partes[0]) if partes else ""
            if clave == "sin" and len(partes) > 1:
                clave, partes = "sin grafico", ["SIN GRÁFICO"]
            tipo = TIPOS.get(clave, "desconocida")
            descripcion = None
            par = NOMBRE_Y_DESCRIPCION.match(partes[1].strip()) if tipo == "imagen" and len(partes) > 1 else None
            if par:  # [IMAGEN nombre "descripción"]: la descripción sirve para generarla con IA
                valor, descripcion = par.group(1), par.group(2).strip()
            else:
                valor = partes[1].strip().strip('"“”«»').strip() if len(partes) > 1 else None
            indicaciones.append({"tipo": tipo, "valor": valor, "original": contenido.strip(), "descripcion": descripcion})
        limpio = " ".join(INDICACION.sub(" ", renglon).split())
        palabras = limpio.split()
        normales = [canonico(t) for t in (normalizar_palabra(p) for p in palabras) if t]
        if normales or indicaciones:
            lineas.append(Linea(len(lineas), limpio, palabras, normales, indicaciones))
    return lineas


def _local(linea: list[str], dicho: list[str], bloqueadas: set[int]) -> Optional[tuple[int, int, int]]:
    """Mejor alineación local (Smith-Waterman) de una línea dentro de lo dicho: (inicio, fin, coincidencias)."""
    m, n = len(linea), len(dicho)
    anterior = [0] * (n + 1)
    origen_anterior = [0] * (n + 1)
    aciertos_anterior = [0] * (n + 1)
    mejor = (0, -1, -1, 0)
    for i in range(1, m + 1):
        actual, origen, aciertos = [0] * (n + 1), [0] * (n + 1), [0] * (n + 1)
        for j in range(1, n + 1):
            if (j - 1) in bloqueadas:
                continue
            coincide = parecidas(linea[i - 1], dicho[j - 1])
            opciones = (
                (anterior[j - 1] + (2 if coincide else -1), origen_anterior[j - 1] if anterior[j - 1] else j - 1,
                 aciertos_anterior[j - 1] + coincide),
                (anterior[j] - 1, origen_anterior[j], aciertos_anterior[j]),
                (actual[j - 1] - 1, origen[j - 1], aciertos[j - 1]),
            )
            puntaje, inicio, buenos = max(opciones, key=lambda o: o[0])
            if puntaje > 0:
                actual[j], origen[j], aciertos[j] = puntaje, inicio, buenos
                if puntaje > mejor[0]:
                    mejor = (puntaje, inicio, j - 1, buenos)
        anterior, origen_anterior, aciertos_anterior = actual, origen, aciertos
    return (mejor[1], mejor[2], mejor[3]) if mejor[0] > 0 else None


def _emparejar(linea: list[str], dicho: list[str]) -> list[tuple[Optional[int], Optional[int]]]:
    """Alineación global (Needleman-Wunsch) palabra a palabra entre la línea y su toma."""
    m, n = len(linea), len(dicho)
    puntos = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(1, m + 1):
        puntos[i][0] = -i
    for j in range(1, n + 1):
        puntos[0][j] = -j
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            puntos[i][j] = max(puntos[i - 1][j - 1] + (2 if parecidas(linea[i - 1], dicho[j - 1]) else -1),
                               puntos[i - 1][j] - 1, puntos[i][j - 1] - 1)
    pares, i, j = [], m, n
    while i > 0 or j > 0:
        if i > 0 and j > 0 and puntos[i][j] == puntos[i - 1][j - 1] + (2 if parecidas(linea[i - 1], dicho[j - 1]) else -1):
            pares.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif i > 0 and puntos[i][j] == puntos[i - 1][j] - 1:
            pares.append((i - 1, None))
            i -= 1
        else:
            pares.append((None, j - 1))
            j -= 1
    return list(reversed(pares))


def alinear(lineas: list[Linea], palabras: list) -> dict:
    """Empareja el libreto con lo dicho. `palabras` son las de la toma (con .i, .texto, .norm, .inicio, .fin)."""
    dicho = [canonico(p.norm) for p in palabras]
    clips = [getattr(p, "clip", 0) for p in palabras]
    resultado, usadas = [], set()
    for linea in lineas:
        if not linea.normales:
            resultado.append({"n": linea.n, "estado": "solo_indicaciones", "toma": None, "otras_tomas": [], "cobertura": 0})
            continue
        ocurrencias, bloqueadas = [], set()
        for _ in range(4):
            encontrada = _local(linea.normales, dicho, bloqueadas)
            if not encontrada:
                break
            inicio, fin, aciertos = encontrada
            cobertura = aciertos / len(linea.normales)
            if cobertura < COBERTURA_MINIMA:
                break
            if len(set(clips[inicio:fin + 1])) == 1:  # una toma nunca cruza de un archivo a otro
                ocurrencias.append({"inicio": inicio, "fin": fin, "cobertura": round(cobertura, 3)})
            bloqueadas.update(range(inicio, fin + 1))
        mejor = max((o["cobertura"] for o in ocurrencias), default=0)
        candidatas = sorted((o for o in ocurrencias if o["cobertura"] >= mejor - CASI_COMPLETA),
                            key=lambda o: o["inicio"], reverse=True)
        elegida = next((o for o in candidatas if not usadas.intersection(range(o["inicio"], o["fin"] + 1))), None)
        if elegida:
            usadas.update(range(elegida["inicio"], elegida["fin"] + 1))
        resultado.append({
            "n": linea.n, "estado": "ok" if elegida else "falta",
            "toma": [palabras[elegida["inicio"]].i, palabras[elegida["fin"]].i] if elegida else None,
            "cobertura": elegida["cobertura"] if elegida else 0,
            "otras_tomas": [[palabras[o["inicio"]].i, palabras[o["fin"]].i] for o in ocurrencias if o is not elegida],
        })

    segmentos: list[list[int]] = []
    for item in resultado:
        if item["toma"]:
            desde, hasta = item["toma"]
            if (segmentos and 0 <= desde - segmentos[-1][1] - 1 <= HUECO_SIN_CORTE
                    and clips[desde] == clips[segmentos[-1][1]]):
                segmentos[-1][1] = hasta
            else:
                segmentos.append([desde, hasta])

    correcciones, recuperadas = [], []
    por_indice = {p.i: p for p in palabras}
    for linea, item in zip(lineas, resultado):
        if not item["toma"]:
            continue
        desde, hasta = item["toma"]
        tramo = [por_indice[i] for i in range(desde, hasta + 1)]
        pares = _emparejar(linea.normales, [canonico(p.norm) for p in tramo])
        visibles = [p for p in linea.palabras if normalizar_palabra(p)]
        ultimo = None
        for i_libreto, i_dicho in pares:
            if i_dicho is not None:
                ultimo = tramo[i_dicho]
            if i_libreto is None:
                continue
            escrita = visibles[i_libreto]
            if i_dicho is None:
                # Solo se recupera si la palabra anterior dura de más: el reconocimiento juntó dos palabras
                # («3000» se quedó con el tiempo de «dólares»). Si no, probablemente no se dijo.
                if ultimo is not None and _exceso(ultimo) >= EXCESO_FUSION:
                    recuperadas.append({"i": ultimo.i, "palabra": escrita})
                continue
            palabra = tramo[i_dicho]
            dicha, libreto_norm = canonico(palabra.norm), linea.normales[i_libreto]
            if not parecidas(dicha, libreto_norm) and difflib.SequenceMatcher(None, dicha, libreto_norm).ratio() < 0.5:
                continue  # dijo otra palabra (un sinónimo, por ejemplo): el subtítulo respeta lo dicho
            if palabra.texto != escrita:
                correcciones.append({"i": palabra.i, "de": palabra.texto, "a": escrita, "fuente": "libreto",
                                     "motivo": f"Línea {linea.n + 1} del libreto"})
    # Las recuperadas se suman a la corrección de su palabra (o crean una).
    for extra in recuperadas:
        existente = next((c for c in correcciones if c["i"] == extra["i"]), None)
        if existente:
            existente["a"] += " " + extra["palabra"]
        else:
            palabra = por_indice[extra["i"]]
            correcciones.append({"i": palabra.i, "de": palabra.texto, "a": f"{palabra.texto} {extra['palabra']}",
                                 "fuente": "libreto", "motivo": "Palabra del libreto que el reconocimiento no captó"})

    otras = {i for item in resultado for desde, hasta in item["otras_tomas"] for i in range(desde, hasta + 1)}
    elegidas = usadas_indices(resultado)
    fuera, actual = [], []
    for p in palabras:
        libre = p.i not in elegidas and p.i not in otras
        if libre:
            actual.append(p)
        if (not libre or p is palabras[-1]) and actual:
            if len(actual) >= FUERA_MINIMO:
                fuera.append({"palabras": [actual[0].i, actual[-1].i], "desde": actual[0].inicio, "hasta": actual[-1].fin,
                              "texto": " ".join(w.texto for w in actual)})
            actual = []

    total = sum(len(l.normales) for l in lineas) or 1
    dichas = sum(item["cobertura"] * len(l.normales) for l, item in zip(lineas, resultado))
    return {
        "lineas": [{"n": l.n, "texto": l.texto, "indicaciones": l.indicaciones, **item} for l, item in zip(lineas, resultado)],
        "segmentos": segmentos,
        "correcciones": correcciones,
        "faltan": [{"n": l.n, "texto": l.texto} for l, item in zip(lineas, resultado) if item["estado"] == "falta"],
        "fuera_del_libreto": fuera,
        "cobertura": round(dichas / total, 3),
    }


def _exceso(palabra) -> float:
    """Segundos de más frente a lo que suele durar una palabra de ese largo (~0,06 s por letra)."""
    return (palabra.fin - palabra.inicio) - (0.12 + 0.06 * len(palabra.norm))


def usadas_indices(resultado: list[dict]) -> set[int]:
    return {i for item in resultado if item["toma"] for i in range(item["toma"][0], item["toma"][1] + 1)}
