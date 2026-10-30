"""Montaje: qué tramos de la toma original se usan y en qué orden.

Un tramo se define por palabras de la toma original (índices inclusivos), no por segundos: así
el corte cae siempre en el silencio entre dos palabras y el plan sigue siendo legible
(«palabras 263–288: Al tercero lo reprenden… lo que le dieron.»). Los tiempos se redondean a
fotogramas para que video, voz y gráficos no se desfasen al encadenar tramos.
"""

from __future__ import annotations

import difflib
import re

from planificador import Palabra
from texto import normalizar_palabra

FPS = 30
AIRE = 0.08  # margen máximo antes de la primera palabra y después de la última de cada tramo
AIRE_INICIAL = 0.25  # al empezar un archivo: se recorta el silencio previo dejando este aire
COLA_FINAL = 0.45


def _por_archivo(palabras: list[Palabra], desde_i: int, hasta_i: int) -> list[tuple[int, int]]:
    """Un tramo nunca cruza de un archivo a otro: si el rango lo hace, se parte."""
    partes, inicio = [], desde_i
    for i in range(desde_i + 1, hasta_i + 1):
        if palabras[i].clip != palabras[i - 1].clip:
            partes.append((inicio, i - 1))
            inicio = i
    return partes + [(inicio, hasta_i)]


def tramos_de(palabras: list[Palabra], segmentos: list[list[int]], *, aire: float = AIRE,
              aire_inicial: float = AIRE_INICIAL, cola_final: float = COLA_FINAL) -> tuple[list[dict], float]:
    """Convierte rangos de palabras en tramos con tiempos de origen y de salida (en fotogramas exactos).

    El aire de cada corte viene de la skill «Recortes»; sin ella, los valores de siempre.
    """
    total = len(palabras)
    tramos, salida = [], 0
    for desde_total, hasta_total in segmentos:
        if not (0 <= desde_total <= hasta_total < total):
            raise ValueError(f"Tramo inválido {desde_total}–{hasta_total}: la toma tiene {total} palabras (0–{total - 1}).")
        for desde_i, hasta_i in _por_archivo(palabras, desde_total, hasta_total):
            primera, ultima = palabras[desde_i], palabras[hasta_i]
            anterior = palabras[desde_i - 1] if desde_i > 0 and palabras[desde_i - 1].clip == primera.clip else None
            siguiente = palabras[hasta_i + 1] if hasta_i + 1 < total and palabras[hasta_i + 1].clip == ultima.clip else None
            # El corte cae en el silencio entre palabras, con un poco de aire si lo hay.
            inicio = (max(0.0, primera.inicio - aire_inicial) if anterior is None
                      else min(primera.inicio, max(anterior.fin, primera.inicio - aire)))
            fin = ultima.fin + cola_final if siguiente is None else max(ultima.fin, min(siguiente.inicio, ultima.fin + aire))
            desde_f, hasta_f = round(inicio * FPS), round(fin * FPS)
            if hasta_f <= desde_f:
                raise ValueError(f"Tramo {desde_i}–{hasta_i} sin duración.")
            tramos.append({
                "palabras": [desde_i, hasta_i], "clip": primera.clip,
                "texto": f"{primera.texto} … {ultima.texto}" if hasta_i > desde_i else primera.texto,
                "desde": desde_f / FPS, "hasta": hasta_f / FPS, "salida": salida / FPS,
            })
            salida += hasta_f - desde_f
    return tramos, round(salida / FPS, 3)


def aplicar(palabras: list[Palabra], tramos: list[dict]) -> tuple[list[Palabra], dict[int, int]]:
    """Palabras del video final (renumeradas, en tiempo de salida) y su índice en la toma original."""
    final: list[Palabra] = []
    origen: dict[int, int] = {}
    for tramo in tramos:
        desde_i, hasta_i = tramo["palabras"]
        desplazamiento = tramo["salida"] - tramo["desde"]
        for p in palabras[desde_i:hasta_i + 1]:
            origen[len(final)] = p.i
            final.append(Palabra(len(final), p.texto, round(p.inicio + desplazamiento, 3), round(p.fin + desplazamiento, 3), p.clip))
    return final, origen


def eliminados(palabras: list[Palabra], segmentos: list[list[int]]) -> list[dict]:
    """Rangos de palabras que no entran al video final, para mostrarlos en el plan."""
    usadas = {i for desde_i, hasta_i in segmentos for i in range(desde_i, hasta_i + 1)}
    rangos, actual = [], []
    for p in palabras:
        if actual and (p.i in usadas or p.clip != actual[-1].clip):
            rangos.append(actual)
            actual = []
        if p.i not in usadas:
            actual.append(p)
    if actual:
        rangos.append(actual)
    return [{"palabras": [r[0].i, r[-1].i], "desde": r[0].inicio, "hasta": r[-1].fin,
             "texto": " ".join(p.texto for p in r)} for r in rangos]


def zoom_de_cortes(tramos: list[dict], duracion: float, escala_corte: float = 1.06) -> list[dict]:
    """En cada corte real el encuadre alterna 100 % / 106 % (o lo que pida «Edición y ritmo»): disimula el salto."""
    zoom = []
    for numero, (anterior, tramo) in enumerate(zip(tramos, tramos[1:]), 1):
        if abs(tramo["desde"] - anterior["hasta"]) < 1e-6 and tramo.get("clip", 0) == anterior.get("clip", 0):
            continue  # tramos contiguos en la toma original: no hay salto
        siguiente = tramos[numero + 1]["salida"] if numero + 1 < len(tramos) else duracion
        escala = escala_corte if len(zoom) % 2 == 0 else 1.0
        zoom.append({"inicio": tramo["salida"], "fin": tramo["salida"], "de": escala, "a": escala, "hasta": siguiente,
                     "motivo": f"Corte de montaje: encuadre al {round(escala * 100)} % para disimular el salto"})
    return zoom


MULETILLAS = {"eh", "ehh", "ehhh", "em", "emm", "emmm", "mm", "mmm", "mmmm", "ah", "ahh", "eeh", "eeeh", "hmm", "uhm", "um"}


def sin_muletillas(palabras: list[Palabra], segmentos: list[list[int]]) -> tuple[list[list[int]], list[str]]:
    """Parte los tramos para saltarse las muletillas sueltas («eh», «mmm»…); devuelve los tramos y lo quitado."""
    nuevos, quitadas = [], []
    for desde, hasta in segmentos:
        actual = None
        for i in range(desde, hasta + 1):
            if normalizar_palabra(palabras[i].texto) in MULETILLAS:
                quitadas.append(palabras[i].texto)
                if actual:
                    nuevos.append(actual)
                actual = None
            elif actual:
                actual[1] = i
            else:
                actual = [i, i]
        if actual:
            nuevos.append(actual)
    return nuevos, quitadas


def quitar_rango(segmentos: list[list[int]], desde: int, hasta: int) -> list[list[int]]:
    """Saca las palabras desde–hasta (de la toma original) del montaje, partiendo el tramo que las tenga."""
    nuevos = []
    for a, b in segmentos:
        if b < desde or a > hasta:
            nuevos.append([a, b])
            continue
        if a < desde:
            nuevos.append([a, desde - 1])
        if b > hasta:
            nuevos.append([hasta + 1, b])
    return nuevos


def agregar_rango(palabras: list[Palabra], segmentos: list[list[int]], desde: int, hasta: int) -> list[list[int]]:
    """Devuelve al montaje las palabras desde–hasta que no estaban: pegadas a su vecina de la toma original si
    esa vecina está en el video, o como tramo nuevo antes del primero que viene después en la toma."""
    nuevos = [list(s) for s in segmentos]
    usadas = {i for a, b in nuevos for i in range(a, b + 1)}
    corridas: list[list[int]] = []
    for i in (i for i in range(desde, hasta + 1) if i not in usadas):
        if corridas and corridas[-1][1] == i - 1 and palabras[i].clip == palabras[i - 1].clip:
            corridas[-1][1] = i
        else:
            corridas.append([i, i])
    for a, b in corridas:
        clip = palabras[a].clip
        anterior = next((s for s in nuevos if s[1] == a - 1 and palabras[s[1]].clip == clip), None)
        siguiente = next((s for s in nuevos if s[0] == b + 1 and palabras[s[0]].clip == clip), None)
        if anterior and siguiente and nuevos.index(siguiente) == nuevos.index(anterior) + 1:
            anterior[1] = siguiente[1]
            nuevos.remove(siguiente)
        elif anterior:
            anterior[1] = b
        elif siguiente:
            siguiente[0] = a
        else:
            nuevos.insert(next((k for k, s in enumerate(nuevos) if s[0] > b), len(nuevos)), [a, b])
    return nuevos


# --- Repeticiones (tomas repetidas dentro de una misma grabación) ------------------------------

BLOQUE_MINIMO = 6        # palabras seguidas iguales para considerar que se repitió una frase
COBERTURA_MINIMA = 0.5   # el bloque debe cubrir al menos la mitad de la frase más corta
ARRANQUE_EN_FALSO = 2    # restos de 1–2 palabras alrededor del bloque se tratan como tropiezo


def _frases(palabras: list[Palabra]) -> list[list[Palabra]]:
    frases, actual = [], []
    for p in palabras:
        if actual and p.clip != actual[-1].clip:
            frases.append(actual)
            actual = []
        actual.append(p)
        if re.search(r"[.?!…]$", p.texto):
            frases.append(actual)
            actual = []
    if actual:
        frases.append(actual)
    return frases


def _rango(frase: list[Palabra]) -> list[int]:
    return [frase[0].i, frase[-1].i]


def _texto(palabras: list[Palabra]) -> str:
    return " ".join(p.texto for p in palabras)


def detectar_repeticiones(palabras: list[Palabra]) -> dict | None:
    """Encuentra frases dichas dos veces y propone dos montajes; None si no hay repeticiones.

    - «usar_ultima»: la versión posterior (normalmente la corregida) ocupa el lugar de la anterior en el relato.
    - «quitar_repeticion»: se conserva la primera versión y se quita la posterior.
    """
    frases = _frases(palabras)
    normal = [[normalizar_palabra(p.texto) for p in f] for f in frases]
    pares: dict[int, dict] = {}  # índice de la frase posterior -> emparejamiento con la anterior
    for j in range(len(frases)):
        for i in range(j):
            if i in pares or min(len(normal[i]), len(normal[j])) < BLOQUE_MINIMO:
                continue
            bloque = max(difflib.SequenceMatcher(None, normal[i], normal[j], autojunk=False).get_matching_blocks(),
                         key=lambda b: b.size)
            if bloque.size >= BLOQUE_MINIMO and bloque.size >= COBERTURA_MINIMA * min(len(normal[i]), len(normal[j])):
                if j not in pares or bloque.size > pares[j]["bloque"].size:
                    pares[j] = {"anterior": i, "bloque": bloque}
    if not pares:
        return None

    sustituciones: dict[int, tuple[list[Palabra], list[Palabra], list[Palabra]]] = {}
    repeticiones = []
    for j, par in sorted(pares.items()):
        i, bloque = par["anterior"], par["bloque"]
        anterior, posterior = frases[i], frases[j]
        # Lo que la versión posterior dice antes y después del bloque reemplaza lo equivalente en la anterior.
        inicio = max(0, bloque.a - bloque.b)
        for k in range(inicio, max(-1, inicio - 3), -1):  # se ajusta al comienzo de la cláusula (tras una coma)
            if k == 0 or anterior[k - 1].texto.endswith((",", ";", ":")):
                inicio = k
                break
        fin = min(len(anterior) - 1, bloque.a + bloque.size + (len(posterior) - bloque.b - bloque.size) - 1)
        antes, despues = anterior[:inicio], anterior[fin + 1:]
        sustituciones[i] = (antes if len(antes) > ARRANQUE_EN_FALSO else [], posterior, despues if len(despues) > ARRANQUE_EN_FALSO else [])
        repeticiones.append({
            "primera": {"palabras": _rango(anterior), "desde": anterior[0].inicio, "hasta": anterior[-1].fin, "texto": _texto(anterior)},
            "repeticion": {"palabras": _rango(posterior), "desde": posterior[0].inicio, "hasta": posterior[-1].fin, "texto": _texto(posterior)},
            "palabras_iguales": bloque.size,
        })

    def segmentos(usar_ultima: bool) -> list[list[int]]:
        rangos: list[list[int]] = []
        for indice, frase in enumerate(frases):
            if indice in pares:
                continue  # la versión posterior se quita de su lugar
            partes = [p for p in sustituciones[indice] if p] if usar_ultima and indice in sustituciones else [frase]
            for parte in partes:
                desde, hasta = _rango(parte)
                if rangos and rangos[-1][1] + 1 == desde:
                    rangos[-1][1] = hasta
                else:
                    rangos.append([desde, hasta])
        return rangos

    return {"repeticiones": repeticiones, "opciones": {
        "usar_ultima": {"segmentos": segmentos(True),
                        "descripcion": "Usa la versión posterior (normalmente la corregida) en el lugar de la primera."},
        "quitar_repeticion": {"segmentos": segmentos(False),
                              "descripcion": "Conserva la primera versión y quita la repetición."},
    }}
