"""Control de calidad medido sobre el archivo renderizado."""

from __future__ import annotations

import json
from pathlib import Path

from audio import RAIZ, TRABAJO, ejecutar, medir_loudness
from subtitulos import cortes_sintacticos_malos

FPS = 30
PICOS_SFX = {"whoosh": -18, "ovacion": -24, "clic": -22, "vibracion": -22, "ping": -18, "pop": -20, "impacto": -20}


def division(t: float, ventanas: list[list[float]]) -> float:
    """Réplica de util.ts: cuánto de pantalla dividida hay en t."""
    valor = 0.0
    for a, b in ventanas:
        lado = min(0.2, (b - a) / 2 - 0.001)
        if t <= a or t >= b:
            continue
        x = min(1.0, (t - a) / lado, (b - t) / lado)
        valor = max(valor, 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2)
    return valor


def revisar_caras(final: Path, timeline: dict) -> dict:
    """Apple Vision sobre el render: ninguna caja de rostro puede cruzarse con el bloque de subtítulos."""
    fuente = RAIZ / "scripts" / "caras.swift"
    binario = TRABAJO / "kiko-caras"
    if not binario.exists() or binario.stat().st_mtime < fuente.stat().st_mtime:
        ejecutar("swiftc", "-O", str(fuente), "-o", str(binario))
    estilo = (timeline.get("estilo") or {}).get("subtitulos") or {}
    if not timeline["subtitulos"] or not estilo.get("activos", True):
        return {"ok": True, "nota": "Subtítulos desactivados en la skill «Subtítulos»: no hay nada que choque con el rostro.", "choques": []}
    completo, medio_alto = estilo.get("centro_completo", 1920 * 0.72), 100 * estilo.get("escala", 1.0)
    tiempos = [round((tarjeta["inicio"] + tarjeta["fin"]) / 2, 3) for tarjeta in timeline["subtitulos"]]
    muestras = json.loads(ejecutar(str(binario), str(final), *map(str, tiempos)).stdout)
    choques, con_rostro = [], 0
    for muestra in muestras:
        # Réplica de Subtitulos.tsx: la posición de la skill en plano completo (72 % por defecto) y la franja
        # del panel (y=790) en pantalla dividida.
        centro = 790 if division(muestra["t"], timeline["layout"]["dividido"]) > 0.5 else completo
        sub_y0, sub_y1 = centro - medio_alto, centro + medio_alto
        for x, y, ancho, alto in muestra["caras"]:
            con_rostro += 1
            if y < sub_y1 and y + alto > sub_y0 and x < 970 and x + ancho > 110:
                choques.append({"t": muestra["t"], "rostro": [x, y, ancho, alto]})
    if not con_rostro:
        return {"ok": True, "nota": "No se detectó ningún rostro (voz guía sin cámara); se valida con tu clip real.", "choques": []}
    return {"ok": not choques, "muestras": len(muestras), "rostros": con_rostro, "choques": choques}


def qc(final: Path, timeline: dict, voz: dict) -> dict:
    sonda = json.loads(ejecutar("npx", "remotion", "ffprobe", "-v", "error", "-show_streams", "-show_format",
                                "-of", "json", str(final), cwd=RAIZ).stdout)
    video = next(s for s in sonda["streams"] if s["codec_type"] == "video")
    audio = next((s for s in sonda["streams"] if s["codec_type"] == "audio"), None)
    duracion = float(video.get("duration") or sonda["format"]["duration"])
    loud = medir_loudness(final)
    sincronia = []
    for sonido in timeline["sonidos"]:
        if "dentro" in sonido:
            a, b = sonido["dentro"]
            ok = a - 1e-3 <= sonido["inicio"] <= b
            detalle = f"dentro de la palabra ({a:.2f}–{b:.2f} s)"
        else:
            fotogramas = (sonido["inicio"] - sonido["referencia"]) * FPS
            ok = abs(fotogramas) <= 2
            detalle = f"{fotogramas:+.1f} fotogramas"
        sincronia.append({"evento": sonido["archivo"].split("/")[-1], "ancla": sonido["ancla"], "detalle": detalle, "ok": ok})
    caras = revisar_caras(final, timeline)
    cortes_malos = cortes_sintacticos_malos(timeline["subtitulos"])
    resultado = {
        "archivo": str(final),
        "resolucion": f"{video['width']}x{video['height']}",
        "fps": video["r_frame_rate"],
        "codec_video": video["codec_name"],
        "audio": audio["codec_name"] if audio else None,
        "duracion_s": round(duracion, 3),
        "duracion_esperada_s": timeline["duracion"],
        "loudness_lufs": float(loud["input_i"]),
        "pico_real_dbtp": float(loud["input_tp"]),
        "subtitulos_mal_cortados": cortes_malos,
        "sfx_mas_alto_dbfs": max(PICOS_SFX.values()),
        "sincronia_efectos": sincronia,
        "subtitulos_vs_rostro": caras,
        "voz": voz,
    }
    resultado["aprobado"] = {
        "1080x1920_30fps": resultado["resolucion"] == "1080x1920" and video["r_frame_rate"] == "30/1",
        "duracion": abs(duracion - timeline["duracion"]) <= 0.1,
        "loudness": abs(resultado["loudness_lufs"] + 14) <= 1,
        "pico_real": resultado["pico_real_dbtp"] <= -0.9,
        "efectos_a_2_fotogramas_de_su_palabra": all(item["ok"] for item in sincronia),
        "subtitulos_sin_cortes_sintacticos": not cortes_malos,
        "subtitulos_no_tapan_rostro": caras["ok"],
    }
    return resultado
