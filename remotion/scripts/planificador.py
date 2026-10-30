"""Planificador semántico: de la transcripción por palabra a un plan de edición revisable.

1. Detección local (siempre corre): países de Natural Earth, conceptos con desambiguación por
   contexto (trofeo, teclado, llamada, moneda), cifras con aviso de verificación e íconos Tabler.
2. Pase de IA opcional (ver ia.py): propone eventos, descartes y correcciones; todo se valida.
3. Reglas editoriales: prioridad, densidad, sin repeticiones y fusión mapa + trofeo.

El plan nunca inventa tiempos: cada evento se ancla a palabras reales de la transcripción.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import lexico
from texto import FUNCIONALES, cierra_oracion, es_mayuscula, normalizar_palabra

RAIZ = Path(__file__).resolve().parents[1]
GEOJSON = RAIZ / "fuentes" / "natural-earth" / "ne_110m_admin_0_countries.geojson"
ICONOS_DIR = RAIZ / "node_modules" / "@tabler" / "icons" / "icons" / "outline"

PRIORIDAD = {"mapa_pais": 5, "trofeo": 4, "teclado": 4, "llamada": 4, "moneda": 4, "texto_cinetico": 3, "icono": 2,
             "imagen": 6, "sonido": 1}
PRIORIDAD_INDICADA = 9  # lo que pides en el libreto o en la revisión manda sobre lo automático
CATALOGO = {
    "mapa_pais": "Mapa de la región con el país resaltado y acercamiento (Natural Earth, dominio público). Solo para lugares en contexto geográfico.",
    "trofeo": "Copa genérica con confeti y la palabra dicha (¡CAMPEÓN!). Para logros deportivos o victorias; sin logotipos reales.",
    "teclado": "Teclado de computador con teclas que se hunden al ritmo de «escribir». No para teclado musical.",
    "llamada": "Pantalla genérica de llamada entrante que vibra; nombre genérico, sin número ni datos reales.",
    "moneda": "Moneda genérica que sube girando y cae (cara o sello). Solo si se lanza; si es dinero o precio, usa icono.",
    "icono": "Ícono vectorial Tabler con la palabra dicha como etiqueta, para un objeto concreto.",
    "texto_cinetico": "La cifra o el concepto dicho, en grande. Nunca un texto que no se dijo.",
    "imagen": "Imagen de tu biblioteca de recursos (propia o con licencia), pedida en el libreto.",
    "sonido": "Sonido de tu biblioteca, sin gráfico, pedido en el libreto.",
}
MARGEN = 0.25          # aire mínimo entre dos gráficos
SEPARACION_INICIOS = 0.8
VENTANA_REPETICION = 12.0


@dataclass
class Palabra:
    i: int
    texto: str
    inicio: float
    fin: float
    clip: int = 0  # archivo de origen cuando el video se arma con varias tomas

    @property
    def norm(self) -> str:
        return normalizar_palabra(self.texto)

    @property
    def limpio(self) -> str:
        return re.sub(r"^[¿¡\"'«(]+|[,.;:!?…\"'»)]+$", "", self.texto)


@dataclass
class Candidato:
    componente: str
    i0: int
    i1: int
    params: dict = field(default_factory=dict)
    justificacion: str = ""
    fuente: str = "local"
    verificar: Optional[str] = None
    clave: str = ""
    id: str = ""
    inicio: float = 0.0
    fin: float = 0.0
    fin_minimo: float = 0.0
    grupo: Optional[str] = None

    @property
    def prioridad(self) -> int:
        return PRIORIDAD_INDICADA if self.fuente in {"libreto", "usuario"} else PRIORIDAD[self.componente]


# --- Recursos ---------------------------------------------------------------------------------

def _tokens(nombre: str) -> tuple[str, ...]:
    return tuple(t for t in (normalizar_palabra(x) for x in re.split(r"[\s\-.,']+", nombre)) if t)


def cargar_paises() -> tuple[dict[tuple[str, ...], str], dict[str, str]]:
    """Nombres (español, inglés, alternativos y alias) -> código ADM0_A3, y código -> nombre en español."""
    datos = json.loads(GEOJSON.read_text(encoding="utf-8"))
    nombres: dict[tuple[str, ...], str] = {}
    oficiales: dict[str, str] = {}
    for feature in datos["features"]:
        props = feature["properties"]
        codigo = props["ADM0_A3"]
        oficiales[codigo] = props.get("NAME_ES") or props["NAME"]
        for campo in ("NAME_ES", "NAME", "NAME_LONG", "ADMIN", "NAME_EN", "NAME_ALT", "NAME_SORT"):
            if props.get(campo):
                nombres.setdefault(_tokens(props[campo]), codigo)
    for alias, codigo in lexico.ALIAS_PAISES.items():
        nombres[_tokens(alias)] = codigo
    nombres.pop((), None)
    return nombres, oficiales


def codigo_pais(valor: str) -> Optional[tuple[str, str]]:
    """(código ADM0_A3, nombre en español) de un país dicho por su nombre o su código."""
    nombres, oficiales = cargar_paises()
    codigo = valor.strip().upper() if valor.strip().upper() in oficiales else nombres.get(_tokens(valor))
    return (codigo, oficiales[codigo]) if codigo else None


def icono_svg(nombre: str) -> Optional[str]:
    ruta = ICONOS_DIR / f"{nombre}.svg"
    return ruta.read_text(encoding="utf-8") if ruta.exists() else None


def _iconos_por_forma() -> dict[str, str]:
    return {forma: icono for formas, icono in lexico.ICONOS.items() for forma in formas if icono_svg(icono)}


# --- Detección local --------------------------------------------------------------------------

def _ventana(palabras: list[Palabra], i: int, antes: int, despues: int) -> list[Palabra]:
    return palabras[max(0, i - antes): i + despues + 1]


def _inicio_oracion(palabras: list[Palabra], i: int) -> bool:
    return i == 0 or cierra_oracion(palabras[i - 1].texto)


def ocurrencias(palabras: list[Palabra], frase: str) -> list[tuple[int, int]]:
    """Índices de cada aparición literal de `frase` (sin tildes ni puntuación) en lo dicho."""
    objetivo = [t for t in (normalizar_palabra(x) for x in frase.split()) if t]
    normales = [p.norm for p in palabras]
    return [(palabras[i].i, palabras[i + len(objetivo) - 1].i) for i in range(len(normales) - len(objetivo) + 1)
            if objetivo and normales[i:i + len(objetivo)] == objetivo]


def buscar_frase(palabras: list[Palabra], frase: str) -> Optional[tuple[int, int]]:
    """Índices de la primera aparición literal de `frase` en lo dicho."""
    return next(iter(ocurrencias(palabras, frase)), None)


def buscar_escritura(palabras: list[Palabra], i: int) -> Optional[Palabra]:
    """Verbo u objeto de escritura cerca de «teclado» (marca el ritmo de las teclas)."""
    return next((w for w in _ventana(palabras, i, 8, 8)
                 if w.norm.startswith(lexico.CONTEXTO_ESCRITURA_RAICES) or w.norm in lexico.CONTEXTO_ESCRITURA), None)


def momento_de_contestar(palabras: list[Palabra], i: int) -> float:
    """La llamada se contesta al empezar la siguiente oración, si llega pronto."""
    p = palabras[i]
    siguiente = next((w for w in palabras[i + 1:] if cierra_oracion(palabras[w.i - 1].texto)), None)
    return round(siguiente.inicio if siguiente and siguiente.inicio - p.inicio <= 2.6 else p.fin + 1.2, 3)


def detectar_paises(palabras: list[Palabra], nombres: dict, oficiales: dict) -> list[Candidato]:
    largo = max(len(k) for k in nombres)
    encontrados, i = [], 0
    while i < len(palabras):
        for n in range(min(largo, 4, len(palabras) - i), 0, -1):
            clave = tuple(p.norm for p in palabras[i:i + n])
            # Exigir mayúscula evita confundir «chile» (ají) o «china» con el país.
            if clave in nombres and es_mayuscula(palabras[i].texto):
                codigo = nombres[clave]
                dicho = " ".join(p.limpio for p in palabras[i:i + n])
                encontrados.append(Candidato(
                    "mapa_pais", i, i + n - 1, {"pais": codigo, "nombre": oficiales[codigo]},
                    f"«{dicho}» nombra un lugar: mapa de la región con {oficiales[codigo]} resaltado y acercamiento.",
                    clave=f"mapa:{codigo}",
                ))
                i += n - 1
                break
        i += 1
    return encontrados


def detectar_conceptos(palabras: list[Palabra], paises: set[int]) -> list[Candidato]:
    iconos = _iconos_por_forma()
    resultado: list[Candidato] = []
    for p in palabras:
        n, i = p.norm, p.i
        cerca = {w.norm for w in _ventana(palabras, i, 5, 5)}
        if n in FUNCIONALES:
            continue

        # Trofeo: «campeón», «trofeo» o «ganar» + contexto deportivo.
        gano = n in {"gane", "ganamos", "gano", "ganaron", "ganaste", "ganar", "ganador", "ganadora", "ganadores"}
        if n.startswith("campeon") or n == "trofeo" or (gano and cerca & lexico.CONTEXTO_DEPORTE):
            propios = [
                w.limpio for w in _ventana(palabras, i, 6, 6)
                if es_mayuscula(w.texto) and w.i not in paises and not _inicio_oracion(palabras, w.i) and w.i != i
            ]
            resultado.append(Candidato(
                "trofeo", i, i, {"texto": f"¡{p.limpio.upper()}!"},
                f"«{p.limpio}» es un logro: copa genérica con confeti, sin trofeos ni logotipos reales.",
                verificar=(f"Se nombra «{', '.join(propios)}» junto a un título: confirma qué ganó antes de presentarlo como hecho."
                           if propios else None),
                clave="trofeo",
            ))
            continue

        # Teclado de computador frente a teclado musical.
        if n in {"teclado", "teclados"}:
            if cerca & lexico.CONTEXTO_MUSICAL:
                svg = icono_svg("piano")
                if svg:
                    resultado.append(Candidato(
                        "icono", i, i, {"icono": "piano"},
                        "Teclado en contexto musical: ícono de piano, no teclado de computador.", clave="icono:piano",
                    ))
                continue
            escritura = buscar_escritura(palabras, i)
            resultado.append(Candidato(
                "teclado", i, i, {"escritura_i": escritura.i if escritura else None},
                "Teclado con acción de escribir: primer plano de teclado con teclas al ritmo de «%s»." % escritura.limpio
                if escritura else "Teclado sin verbo de escritura cerca: se ilustra, pero revisa si aporta.",
                clave="teclado",
            ))
            continue

        # Llamada telefónica frente a «me llamo Federico» o «la llama».
        if n.startswith("llam") and not n.startswith("llamativ"):
            anterior = palabras[i - 1].norm if i > 0 else ""
            siguiente = palabras[i + 1] if i + 1 < len(palabras) else None
            nombrar = (
                (n == "llamo" and anterior == "me")
                or (anterior in {"me", "se", "te", "nos"} and siguiente is not None
                    and (es_mayuscula(siguiente.texto) or siguiente.norm in {"asi", "como"}))
                or (n in {"llamado", "llamada"} and siguiente is not None and es_mayuscula(siguiente.texto))
                or (anterior == "que" and i >= 2 and palabras[i - 2].norm == "lo")
            )
            animal = anterior in {"la", "las", "una", "unas"} and n in {"llama", "llamas"}
            if not nombrar and not animal:
                persona = next((w for w in palabras[i + 1:i + 16] if w.norm in lexico.PERSONAS_DE_LLAMADA), None)
                resultado.append(Candidato(
                    "llamada", i, i, {"nombre": persona.limpio.capitalize() if persona else "Contacto",
                                      "contesta": momento_de_contestar(palabras, i)},
                    "«%s» es una llamada: pantalla genérica que vibra%s." % (
                        p.limpio, f" y muestra «{persona.limpio.capitalize()}», dicho en el video" if persona else ""),
                    clave="llamada",
                ))
            continue

        # Moneda lanzada frente a moneda como dinero.
        if n in {"moneda", "monedas"}:
            ventana = _ventana(palabras, i, 4, 4)
            lanzamiento = next((w for w in ventana if w.norm.startswith(lexico.CONTEXTO_LANZAMIENTO_RAICES)
                                or w.norm in lexico.CONTEXTO_LANZAMIENTO), None)
            if lanzamiento:
                i0 = lanzamiento.i if lanzamiento.i < i else i
                resultado.append(Candidato(
                    "moneda", i0, i, {"aterriza": round(p.fin, 3)},
                    f"«{lanzamiento.limpio}» + «{p.limpio}»: lanzamiento, moneda que gira y cae al terminar la palabra.",
                    clave="moneda",
                ))
            else:
                dinero = any(w.norm.startswith(lexico.CONTEXTO_DINERO_RAICES) or w.norm in lexico.CONTEXTO_DINERO for w in ventana)
                resultado.append(Candidato(
                    "icono", i, i, {"icono": "coins" if dinero else "coin"},
                    "Moneda como dinero: visual financiero, no lanzamiento." if dinero else "Moneda sin lanzamiento: ícono simple.",
                    clave="icono:coins" if dinero else "icono:coin",
                ))
            continue

        # Inteligencia artificial: visual tecnológico discreto, nunca un robot genérico.
        if n == "ia" or (n == "inteligencia" and i + 1 < len(palabras) and palabras[i + 1].norm == "artificial"):
            resultado.append(Candidato(
                "icono", i, i + (0 if n == "ia" else 1), {"icono": "cpu"},
                "Inteligencia artificial: visual tecnológico discreto, sin robots genéricos.", clave="icono:cpu",
            ))
            continue

        # «te llaman por teléfono»: el teléfono ya lo cubre la llamada.
        if n in lexico.TELEFONO and any(w.norm.startswith("llam") for w in _ventana(palabras, i, 6, 2)):
            continue
        if n in iconos and n not in {w.norm for w in palabras if w.i in paises}:
            resultado.append(Candidato(
                "icono", i, i, {"icono": iconos[n]},
                f"«{p.limpio}» es un objeto concreto: ícono «{iconos[n]}» con la palabra dicha.", clave=f"icono:{iconos[n]}",
            ))
    return resultado


def _es_numero(p: Palabra) -> bool:
    return bool(re.fullmatch(r"\d+([.,]\d+)?", p.texto.strip("%,.;:!?¿¡$"))) or p.norm in lexico.MAGNITUDES


def detectar_cifras(palabras: list[Palabra]) -> list[Candidato]:
    resultado, i = [], 0
    while i < len(palabras):
        if not _es_numero(palabras[i]):
            i += 1
            continue
        j = i
        while j + 1 < len(palabras) and j - i < 3 and (
            _es_numero(palabras[j + 1]) or palabras[j + 1].norm in lexico.UNIDADES or palabras[j + 1].norm in {"por", "ciento"}
            or palabras[j + 1].texto.strip(",.;:") == "%"
        ) and not cierra_oracion(palabras[j].texto):
            j += 1
        partes = palabras[i:j + 1]
        if partes[-1].norm == "por":
            partes = partes[:-1]
            j -= 1
        digitos = [int(re.sub(r"\D", "", p.texto) or 0) for p in partes if re.search(r"\d", p.texto)]
        anio = any(1900 <= d <= 2100 for d in digitos)
        relevante = (
            any(d >= 10 for d in digitos) or anio or any(p.norm in lexico.MAGNITUDES for p in partes)
            or any(p.norm in lexico.UNIDADES or "%" in p.texto for p in partes[1:]) or "%" in partes[0].texto
        )
        if relevante:
            texto = " ".join(p.limpio for p in partes).upper()
            contexto = {w.norm for w in _ventana(palabras, i, 10, 10)} & lexico.CONTEXTO_VERIFICAR_CIFRA
            resultado.append(Candidato(
                "texto_cinetico", i, j, {"texto": texto, "estilo": "cifra"},
                f"Cifra dicha («{texto}»): se muestra tal cual, sin añadir datos.",
                verificar=("Cifra en contexto económico o político: verifícala con una fuente antes de publicar."
                           if contexto else "Cifra dicha en cámara: confirma que es correcta antes de publicar."),
                clave=f"cifra:{texto}",
            ))
        i = j + 1
    return resultado


# --- Tiempos y reglas editoriales -------------------------------------------------------------

def _tiempos(c: Candidato, palabras: list[Palabra], fin_video: float) -> None:
    ancla_inicio, ancla_fin = palabras[c.i0].inicio, palabras[c.i1].fin
    c.inicio = round(max(0.0, ancla_inicio - 0.08), 3)
    if c.componente == "mapa_pais":
        fin = min(c.inicio + 3.0, max(ancla_fin + 1.6, c.inicio + 2.2))
        minimo = c.inicio + 1.6
    elif c.componente == "trofeo":
        fin, minimo = ancla_fin + 1.0, ancla_fin + 0.5
    elif c.componente == "teclado":
        escritura = c.params.get("escritura_i")
        final_escritura = palabras[escritura].fin if escritura is not None and escritura >= c.i0 else ancla_fin
        fin = max(c.inicio + 1.4, final_escritura + 0.1)
        minimo = max(c.inicio + 1.0, final_escritura)
    elif c.componente == "llamada":
        fin = min(c.inicio + 3.2, c.params["contesta"] + 1.0)
        minimo = max(c.inicio + 1.2, ancla_fin + 0.8)
    elif c.componente == "moneda":
        fin, minimo = c.params["aterriza"] + 0.5, c.params["aterriza"] + 0.25
    elif c.componente == "icono":
        fin, minimo = c.inicio + 1.5, c.inicio + 0.9
    elif c.componente == "imagen":
        fin = max(c.inicio + 1.6, min(c.inicio + 3.5, ancla_fin + 0.4))
        minimo = c.inicio + 1.2
    elif c.componente == "sonido":
        fin = minimo = c.inicio + 0.5
    else:
        fin = min(max(c.inicio + 1.4, ancla_fin + 0.5), c.inicio + 4.0)
        minimo = max(c.inicio + 0.9, min(ancla_fin + 0.2, c.inicio + 3.0))
    if c.params.get("ajuste_inicio"):
        # Ajuste fino desde la línea de tiempo: se mueve el gráfico (y su sonido) sin cambiar su ancla.
        c.inicio = round(max(0.0, c.inicio + float(c.params["ajuste_inicio"])), 3)
        fin, minimo = fin + float(c.params["ajuste_inicio"]), minimo + float(c.params["ajuste_inicio"])
    if c.params.get("duracion"):
        fin = minimo = c.inicio + max(0.5, float(c.params["duracion"]))
    c.fin = round(min(fin, fin_video), 3)
    c.fin_minimo = round(min(minimo, c.fin), 3)


def _fusionar_mapa_y_trofeo(candidatos: list[Candidato]) -> None:
    """«Brasil … campeón»: la copa sube sobre el mapa atenuado; es una sola idea, no dos cortes."""
    for mapa in (c for c in candidatos if c.componente == "mapa_pais"):
        trofeo = next((c for c in candidatos if c.componente == "trofeo" and c.grupo is None
                       and mapa.inicio < c.inicio <= mapa.inicio + 4.0), None)
        if trofeo:
            grupo = f"g{mapa.i0}"
            mapa.grupo = trofeo.grupo = grupo
            mapa.params["atenuar_desde"] = trofeo.inicio
            trofeo.params["sobre_mapa"] = mapa.params["pais"]
            mapa.fin = max(mapa.fin, trofeo.fin)
            mapa.fin_minimo = max(mapa.fin_minimo, trofeo.fin_minimo)


DENSIDAD = {"baja": 3, "media": 6}  # gráficos automáticos por minuto (skill «Efectos visuales»)


def seleccionar(candidatos: list[Candidato], *, margen: float = MARGEN, componentes: Optional[set[str]] = None,
                densidad: str = "alta", duracion: float = 60.0) -> tuple[list[Candidato], list[dict]]:
    """Elige qué gráficos entran. `componentes` y `densidad` vienen de la skill «Efectos visuales» y solo
    limitan los gráficos automáticos: lo que pide el libreto o agregas a mano siempre se respeta."""
    aceptados: list[Candidato] = []
    descartados: list[dict] = []

    def descartar(c: Candidato, motivo: str) -> None:
        descartados.append({"componente": c.componente, "ancla": c.params.get("_texto", ""), "inicio": c.inicio,
                            "fuente": c.fuente, "motivo": motivo, "id": c.id})

    def automatico(c: Candidato) -> bool:
        return c.fuente not in {"libreto", "usuario"} and c.componente not in {"imagen", "sonido"}

    for c in sorted(candidatos, key=lambda c: (-c.prioridad, c.inicio)):
        if c.componente == "sonido":  # solo audio: no ocupa el panel ni compite con los gráficos
            aceptados.append(c)
            continue
        if componentes is not None and automatico(c) and c.componente not in componentes:
            descartar(c, "La skill «Efectos visuales» no tiene activado este tipo de gráfico.")
            continue
        repetido = next((a for a in aceptados if a.clave == c.clave and abs(a.inicio - c.inicio) < VENTANA_REPETICION), None)
        if repetido:
            descartar(c, f"Repetido: ya se ilustró «{repetido.params.get('_texto')}» a {abs(c.inicio - repetido.inicio):.1f} s.")
            continue
        conflicto = None
        for a in aceptados:
            if (c.grupo and a.grupo == c.grupo) or a.componente == "sonido":
                continue
            if c.inicio < a.fin + margen and a.inicio < c.fin + margen:
                # Se intenta recortar al anterior sin bajar de su duración mínima.
                primero, segundo = (a, c) if a.inicio <= c.inicio else (c, a)
                nuevo_fin = segundo.inicio - margen
                if abs(a.inicio - c.inicio) >= SEPARACION_INICIOS and nuevo_fin >= primero.fin_minimo:
                    continue
                conflicto = a
                break
        if conflicto:
            descartar(c, f"Se cruza con {conflicto.componente} «{conflicto.params.get('_texto')}», de prioridad mayor o igual.")
            continue
        aceptados.append(c)

    if densidad in DENSIDAD:
        limite = max(1, math.ceil(DENSIDAD[densidad] * duracion / 60))
        automaticos = sorted((c for c in aceptados if automatico(c)), key=lambda c: (-c.prioridad, c.inicio))
        for c in automaticos[limite:]:
            aceptados.remove(c)
            descartar(c, f"Límite de la skill «Efectos visuales»: hasta {DENSIDAD[densidad]} gráficos por minuto.")

    aceptados.sort(key=lambda c: c.inicio)
    visuales = [c for c in aceptados if c.componente != "sonido"]
    for actual, siguiente in zip(visuales, visuales[1:]):
        if actual.grupo and actual.grupo == siguiente.grupo:
            continue
        actual.fin = round(min(actual.fin, siguiente.inicio - margen), 3)
        if actual.grupo:
            for compañero in visuales:
                if compañero.grupo == actual.grupo:
                    compañero.fin = round(min(compañero.fin, siguiente.inicio - margen), 3)
    return aceptados, descartados


# --- Sonido y cámara --------------------------------------------------------------------------

def sonidos_de(c: Candidato, palabras: list[Palabra]) -> list[dict]:
    sonidos = _sonidos_de(c, palabras)
    ajuste = float(c.params.get("ajuste_inicio") or 0)
    if ajuste:
        # Si el gráfico se movió a mano, su sonido se mueve con él (y la sincronía se mide contra ese punto).
        for sonido in sonidos:
            sonido["inicio"] = round(max(0.0, sonido["inicio"] + ajuste), 3)
            if "referencia" in sonido:
                sonido["referencia"] = round(sonido["referencia"] + ajuste, 3)
            if "dentro" in sonido:
                sonido["dentro"] = [round(sonido["dentro"][0] + ajuste, 3), round(sonido["dentro"][1] + ajuste, 3)]
    return sonidos


def _sonidos_de(c: Candidato, palabras: list[Palabra]) -> list[dict]:
    ancla = palabras[c.i0]
    if c.componente == "sonido":
        return [{"archivo": c.params["archivo"], "inicio": ancla.inicio, "ancla": ancla.limpio, "referencia": ancla.inicio}]
    if c.componente == "imagen":
        return [{"archivo": "audio/sfx/whoosh.wav", "inicio": round(ancla.inicio - 0.04, 3), "ancla": ancla.limpio, "referencia": ancla.inicio}]
    if c.componente == "mapa_pais":
        return [{"archivo": "audio/sfx/whoosh.wav", "inicio": round(ancla.inicio - 0.04, 3), "ancla": ancla.limpio, "referencia": ancla.inicio}]
    if c.componente == "trofeo":
        return [{"archivo": "audio/sfx/ovacion.wav", "inicio": round(ancla.inicio + 0.05, 3), "ancla": ancla.limpio, "referencia": ancla.inicio}]
    if c.componente == "teclado":
        palabra = palabras[c.params["escritura_i"]] if c.params.get("escritura_i") is not None else ancla
        paso = (palabra.fin - palabra.inicio) / 4
        return [{"archivo": "audio/sfx/clic.wav", "inicio": round(palabra.inicio + k * paso, 3), "ancla": palabra.limpio,
                 "dentro": [palabra.inicio, palabra.fin]} for k in range(4)]
    if c.componente == "llamada":
        return [{"archivo": "audio/sfx/vibracion.wav", "inicio": ancla.inicio, "ancla": ancla.limpio, "referencia": ancla.inicio}]
    if c.componente == "moneda":
        aterriza = c.params["aterriza"]
        return [{"archivo": "audio/sfx/ping.wav", "inicio": round(aterriza + 0.02, 3), "ancla": f"{palabras[c.i1].limpio} (aterrizaje)",
                 "referencia": aterriza}]
    archivo = "audio/sfx/pop.wav" if c.componente == "icono" else "audio/sfx/impacto.wav"
    return [{"archivo": archivo, "inicio": round(ancla.inicio + 0.02, 3), "ancla": ancla.limpio, "referencia": ancla.inicio}]


def camara(palabras: list[Palabra], eventos: list[Candidato], duracion: float) -> list[dict]:
    primer_grafico = min((e.inicio for e in eventos), default=duracion)
    zoom = [{"inicio": 0.0, "fin": 0.4, "de": 1.0, "a": 1.08, "hasta": round(primer_grafico, 3), "motivo": "Gancho: acercamiento al presentador"}]
    # Remate: acercamiento rápido en la última palabra con contenido, si no hay un gráfico encima.
    final = next((p for p in reversed(palabras) if p.norm not in FUNCIONALES), None)
    if final and all(final.inicio >= e.fin for e in eventos):
        zoom.append({"inicio": final.inicio, "fin": round(final.inicio + 0.15, 3), "de": 1.0, "a": 1.12, "hasta": duracion,
                     "motivo": f"Remate sobre «{final.limpio}»"})
    return zoom


# --- Ensamblado -------------------------------------------------------------------------------

def candidatos_locales(palabras: list[Palabra]) -> list[Candidato]:
    nombres, oficiales = cargar_paises()
    paises = detectar_paises(palabras, nombres, oficiales)
    indices_paises = {i for c in paises for i in range(c.i0, c.i1 + 1)}
    return paises + detectar_conceptos(palabras, indices_paises) + detectar_cifras(palabras)


def construir_plan(palabras: list[Palabra], candidatos: list[Candidato], fuente: dict, *, ia: dict,
                   correcciones: list[dict], descartes_ia: list[dict], duracion: Optional[float] = None,
                   origen: Optional[dict[int, int]] = None, efectos: Optional[dict] = None) -> dict:
    """`palabras` son las del video final; `origen` traduce cada índice al de la toma original (montaje)."""
    duracion = round(duracion if duracion is not None else palabras[-1].fin + 0.45, 3)
    origen = origen or {p.i: p.i for p in palabras}
    for numero, c in enumerate(candidatos):
        c.id = c.id or f"c{numero}"
        c.params["_texto"] = " ".join(p.limpio for p in palabras[c.i0:c.i1 + 1])
        _tiempos(c, palabras, duracion)
    _fusionar_mapa_y_trofeo(candidatos)
    eventos, descartados = seleccionar(candidatos, duracion=duracion, **(efectos or {}))
    plan_eventos = []
    for e in eventos:
        params = {k: v for k, v in e.params.items() if not k.startswith("_")}
        texto = e.params["_texto"]
        if e.componente == "mapa_pais":
            params.update({"resalta": palabras[e.i0].inicio, "zoom_inicio": round(palabras[e.i0].inicio - 0.03, 3),
                           "zoom_fin": round(palabras[e.i0].inicio + 1.17, 3)})
        elif e.componente == "trofeo":
            params.setdefault("texto", f"¡{palabras[e.i0].limpio.upper()}!")
            params["texto_en"] = palabras[e.i0].inicio
        elif e.componente == "texto_cinetico":
            # Si nadie lo editó a mano, sale de las palabras dichas (ya corregidas).
            params.setdefault("texto", texto.upper())
        elif e.componente == "teclado":
            params = {"pulsaciones": [s["inicio"] for s in sonidos_de(e, palabras)],
                      **({"sin_sonido": True} if params.get("sin_sonido") else {})}
        elif e.componente == "llamada":
            v = palabras[e.i0].inicio
            params["vibracion"] = [[v, round(v + 0.3, 3)], [round(v + 0.4, 3), round(v + 0.7, 3)]]
        elif e.componente == "icono":
            params.update({"etiqueta": "" if params.get("sin_etiqueta") else texto.upper(), "svg": icono_svg(params["icono"])})
        plan_eventos.append({
            "id": e.id, "componente": e.componente, "inicio": e.inicio, "fin": e.fin,
            "ancla": {"i0": e.i0, "i1": e.i1, "texto": texto},
            "ancla_fuente": {"i0": origen[e.i0], "i1": origen[e.i1]}, "clave": e.clave,
            "params": params, "sonidos": [] if params.get("sin_sonido") else sonidos_de(e, palabras),
            "capa": "V3", "layout": "dividido", "prioridad": e.prioridad, "grupo": e.grupo,
            "fuente": e.fuente, "justificacion": e.justificacion, "verificar": e.verificar,
        })
    return {
        "schema": "kiko.plan-edicion.v2",
        "estado": {"planeado": True, "aprobado": False, "implementado": False, "validado": False},
        "fuente": fuente,
        "duracion": duracion,
        "palabras": [{"i": p.i, "texto": p.texto, "inicio": p.inicio, "fin": p.fin, "clip": p.clip} for p in palabras],
        "correcciones": correcciones,
        "ia": ia,
        "eventos": plan_eventos,
        "descartados": descartados + descartes_ia,
        "camara": {"zoom": camara(palabras, eventos, duracion)},
        "musica": {"activada": True, "nivel": "-30 LUFS bajo la voz, +10 dB sin voz"},
    }


def resumen_markdown(plan: dict, nombre: str) -> str:
    fuente, ia = plan["fuente"], plan["ia"]
    lineas = [
        f"# Plan de edición: {nombre}",
        "",
        "**Estado: planeado, pendiente de tu aprobación. Nada se ha renderizado.**",
        "",
        f"- Fuente: {fuente.get('original') or 'voz guía sintética'} · {plan['duracion']:.1f} s · {len(plan['palabras'])} palabras",
        f"- Análisis local: siempre · IA: {ia['estado']}" + (f" ({ia['proveedor']})" if ia.get("proveedor") else ""),
    ]
    guia = plan.get("libreto")
    if guia:
        lineas += ["", f"## Libreto: {guia['cobertura']:.0%} coincide con lo dicho", ""]
        lineas += [f"- Falta la línea {f['n'] + 1}: «{f['texto']}»" for f in guia["faltan"]]
        lineas += [f"- Dicho fuera del libreto ({f['desde']:.1f} s): «{f['texto'][:120]}»" for f in guia["fuera_del_libreto"]]
        lineas += [f"- Aviso: {a}" for a in guia["avisos"]]
        repetidas = [l for l in guia["lineas"] if l.get("otras_tomas")]
        lineas += [f"- Línea {l['n'] + 1} dicha {len(l['otras_tomas']) + 1} veces: se usa la toma más reciente y completa." for l in repetidas]
        if not (guia["faltan"] or guia["fuera_del_libreto"] or guia["avisos"] or repetidas):
            lineas.append("- Todo el libreto se dijo una vez y en orden.")
    montaje = plan.get("montaje")
    if montaje and (len(montaje["tramos"]) > 1 or montaje["eliminados"]):
        lineas += [
            "",
            f"## Montaje: {len(montaje['tramos'])} tramos, {plan['duracion']:.1f} s finales",
            "",
            "| # | Toma original | Palabras | Dice | Entra en el video |",
            "|---|---|---|---|---|",
        ]
        lineas += [f"| {n} | {t['desde']:.2f}–{t['hasta']:.2f} s | {t['palabras'][0]}–{t['palabras'][1]} | {t['texto']} | {t['salida']:.2f} s |"
                   for n, t in enumerate(montaje["tramos"], 1)]
        lineas += ["", "Se elimina:", ""]
        lineas += [f"- {e['desde']:.2f}–{e['hasta']:.2f} s (palabras {e['palabras'][0]}–{e['palabras'][1]}): «{e['texto'][:160]}{'…' if len(e['texto']) > 160 else ''}»"
                   for e in montaje["eliminados"]] or ["- Nada."]
    lineas += [
        "",
        f"## Eventos ({len(plan['eventos'])})",
        "",
        "| # | Tiempo | Dice | Gráfico | Sonido | Por qué | Verificar |",
        "|---|---|---|---|---|---|---|",
    ]
    for numero, e in enumerate(plan["eventos"], 1):
        recurso = e["componente"]
        if e["componente"] == "mapa_pais":
            recurso = f"Mapa: {e['params']['nombre']}"
        elif e["componente"] == "icono":
            recurso = f"Ícono «{e['params']['icono']}»"
        elif e["componente"] == "trofeo":
            recurso = "Copa" + (" sobre el mapa" if e["params"].get("sobre_mapa") else "") + f" · {e['params']['texto']}"
        elif e["componente"] == "llamada":
            recurso = f"Llamada · {e['params']['nombre']}"
        elif e["componente"] == "texto_cinetico":
            recurso = f"Texto · {e['params']['texto']}"
        sonido = ", ".join(sorted({s["archivo"].split("/")[-1].replace(".wav", "") for s in e["sonidos"]}))
        lineas.append(
            f"| {numero} | {e['inicio']:.2f}–{e['fin']:.2f} s | «{e['ancla']['texto']}» | {recurso} | {sonido} | "
            f"{e['justificacion']} ({e['fuente']}) | {e['verificar'] or ''} |"
        )
    lineas += ["", "## Cámara", ""]
    lineas += [f"- {z['inicio']:.2f} s: {z['motivo']} ({z['de']:.2f} → {z['a']:.2f})" for z in plan["camara"]["zoom"]]
    lineas += ["", "## Correcciones de transcripción (ya aplicadas en el plan; para revertir una, edita esa palabra)", ""]
    lineas += ([f"- Palabra {c['i']}: «{c['de']}» → «{c['a']}» ({c['fuente']}: {c['motivo']})" for c in plan["correcciones"]]
               or ["- Ninguna."])
    lineas += ["", "## Descartados", ""]
    lineas += ([f"- {d['inicio']:.2f} s · {d['componente']} «{d['ancla']}» ({d['fuente']}): {d['motivo']}" for d in plan["descartados"]]
               or ["- Ninguno."])
    lineas += [
        "",
        "## Para aprobar",
        "",
        "Si quieres cambiar algo, edita `plan_edicion.json` (borra eventos, cambia textos o ajusta `montaje.segmentos`,",
        "que son rangos de palabras de la toma original) y recalcula los tiempos:",
        "",
        "```bash",
        f"python3 scripts/editor.py rehacer --plan trabajo/{nombre}/plan_edicion.json",
        "```",
        "",
        "Cuando esté como quieres:",
        "",
        "```bash",
        f"python3 scripts/editor.py render --plan trabajo/{nombre}/plan_edicion.json",
        "```",
    ]
    return "\n".join(lineas) + "\n"


# --- Indicaciones del libreto ------------------------------------------------------------------

def clave_recurso(nombre: str) -> str:
    return normalizar_palabra(Path(nombre or "").stem)


def eventos_de_libreto(alineacion: dict, palabras: list[Palabra], recursos: dict[str, dict]
                       ) -> tuple[list[Candidato], list[str], list[tuple[int, int]]]:
    """Indicaciones del libreto → (eventos, avisos, rangos de palabras sin gráficos automáticos)."""
    nombres, oficiales = cargar_paises()
    por_indice = {p.i: p for p in palabras}
    candidatos, avisos, sin_grafico = [], [], []
    for linea in alineacion["lineas"]:
        numero = linea["n"] + 1
        if not linea["indicaciones"]:
            continue
        if not linea["toma"]:
            avisos.append(f"Línea {numero}: sus indicaciones no se aplican porque esa línea no aparece en la toma.")
            continue
        desde, hasta = linea["toma"]
        tramo = [por_indice[i] for i in range(desde, hasta + 1)]
        for orden, indicacion in enumerate(linea["indicaciones"]):
            tipo, valor = indicacion["tipo"], indicacion["valor"]
            base = {"justificacion": f"Indicación del libreto (línea {numero}): [{indicacion['original']}].",
                    "fuente": "libreto", "clave": f"libreto:{linea['n']}:{orden}"}
            if tipo == "sin_grafico":
                sin_grafico.append((desde, hasta))
            elif tipo == "texto":
                rango = buscar_frase(tramo, valor) if valor else None
                i0, i1 = rango or ((desde, hasta) if not valor else (desde, min(hasta, desde + 2)))
                texto = re.sub(r"[,.;:…]+$", "", valor or linea["texto"]).upper()[:90]
                estilo = "cifra" if re.fullmatch(r"[\d.,%$ ]+", valor or "") else "concepto"
                candidatos.append(Candidato("texto_cinetico", i0, i1, {"texto": texto, "estilo": estilo}, **base))
            elif tipo == "mapa":
                codigo = nombres.get(_tokens(valor or ""))
                if not codigo:
                    avisos.append(f"Línea {numero}: no reconozco el país «{valor}» para [MAPA].")
                    continue
                i0, i1 = buscar_frase(tramo, valor) or (desde, desde)
                candidatos.append(Candidato("mapa_pais", i0, i1, {"pais": codigo, "nombre": oficiales[codigo]}, **base))
            elif tipo == "icono":
                nombre = (valor or "").strip().lower()
                if not icono_svg(nombre):
                    avisos.append(f"Línea {numero}: el ícono «{valor}» no existe en Tabler (tabler.io/icons).")
                    continue
                candidatos.append(Candidato("icono", desde, desde, {"icono": nombre, "sin_etiqueta": True}, **base))
            elif tipo in {"imagen", "sonido"}:
                recurso = recursos.get(clave_recurso(valor))
                esperado = {"imagen": {"image", "logo"}, "sonido": {"sound"}}[tipo]
                if not recurso or recurso["tipo"] not in esperado:
                    avisos.append(f"Línea {numero}: no encuentro «{valor}» en tus recursos; "
                                  + ("súbela o genérala con IA con ese nombre." if tipo == "imagen" else "súbelo con ese nombre."))
                    continue
                params = {"recurso": recurso["nombre"], "archivo": recurso["archivo"]}
                candidatos.append(Candidato(tipo, desde, desde if tipo == "sonido" else hasta, params, **base))
            else:
                avisos.append(f"Línea {numero}: no entiendo la indicación [{indicacion['original']}].")
    return candidatos, avisos, sin_grafico
