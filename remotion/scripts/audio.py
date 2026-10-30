"""Audio local: voz guía, cadena de voz nativa, loudness en dos pasadas y base musical."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from texto import normalizar_palabra

RAIZ = Path(__file__).resolve().parents[1]
TRABAJO = RAIZ / "trabajo"
PUBLICO = RAIZ / "public"
LOOPS = Path("/Library/Audio/Apple Loops/Apple/07 Chillwave")


def ejecutar(*comando: str, **kwargs) -> subprocess.CompletedProcess:
    proceso = subprocess.run(list(comando), capture_output=True, text=True, **kwargs)
    if proceso.returncode != 0:
        raise SystemExit(f"Falló {' '.join(comando[:3])}…\n{proceso.stderr.strip()[-1500:]}")
    return proceso


def ffmpeg(*argumentos: str) -> subprocess.CompletedProcess:
    return ejecutar("npx", "remotion", "ffmpeg", "-hide_banner", "-nostats", *argumentos, cwd=RAIZ)


def medir_loudness(ruta: Path) -> dict:
    texto = ffmpeg("-i", str(ruta), "-vn", "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-").stderr
    return json.loads(texto[texto.rindex("{"): texto.rindex("}") + 1])


def normalizar(origen: Path, destino: Path, *, video: bool = False) -> dict:
    """loudnorm en dos pasadas a -14 LUFS / -1 dBTP.

    En el video final se apunta a -1,5 dBTP: el códec AAC añade picos entre muestras
    después de normalizar (con una toma real quedó en -0,88 dBTP apuntando a -1).
    """
    medido = medir_loudness(origen)
    filtro = (
        "loudnorm=I=-14:TP={tp}:LRA=11:measured_I={input_i}:measured_TP={input_tp}:"
        "measured_LRA={input_lra}:measured_thresh={input_thresh}:offset={target_offset}:linear=true"
    ).format(tp=-1.5 if video else -1, **medido)
    if video:
        # loudnorm deja ~0,1 s de cola: -shortest recorta el audio a la duración del video.
        ffmpeg("-y", "-i", str(origen), "-af", filtro, "-ar", "48000", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
               "-shortest", str(destino))
    else:
        ffmpeg("-y", "-i", str(origen), "-af", filtro, "-ar", "48000", "-c:a", "pcm_s16le", str(destino))
    return medido


def voz_guia(texto: str, destino: Path) -> Path:
    """Voz sintética de macOS para probar un guion sin grabarlo."""
    if not destino.exists():
        aiff = destino.with_suffix(".aiff")
        ejecutar("say", "-v", "Paulina", "-r", "172", "-o", str(aiff), texto)
        ejecutar("afconvert", "-f", "WAVE", "-d", "LEI16@48000", "-c", "1", str(aiff), str(destino))
    return destino


def cadena_voz(origen: Path, proyecto: str, *, limpieza: bool = True, aislamiento: float = 65) -> dict:
    """Aislamiento, EQ, de-esser, compresor y limitador nativos; después -14 LUFS.

    Sin limpieza (skill «Sonido») solo se extrae la voz original y se normaliza.
    """
    intermedio = TRABAJO / proyecto / "voz_cadena.wav"
    intermedio.parent.mkdir(parents=True, exist_ok=True)
    if limpieza:
        fuente = RAIZ / "scripts" / "cadena_voz.swift"
        binario = TRABAJO / "kiko-cadena-voz"
        if not binario.exists() or binario.stat().st_mtime < fuente.stat().st_mtime:
            ejecutar("swiftc", "-O", str(fuente), "-o", str(binario))
        informe = json.loads(ejecutar(str(binario), str(origen), str(intermedio), str(round(aislamiento))).stdout)
    else:
        ffmpeg("-y", "-i", str(origen), "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", str(intermedio))
        informe = {"cadena": "sin limpieza (skill Sonido)"}
    destino = PUBLICO / "audio" / "voz" / f"{proyecto}.wav"
    destino.parent.mkdir(parents=True, exist_ok=True)
    medido = normalizar(intermedio, destino)
    informe.update({
        "archivo": f"audio/voz/{proyecto}.wav",
        "loudness_antes": float(medido["input_i"]),
        "pico_antes": float(medido["input_tp"]),
    })
    return informe


def preparar_musica(propia: Path | None = None, nombre: str = "base", nivel: float = -30) -> dict:
    """Tu música (de la biblioteca de recursos) o, si no subiste, una base con dos capas de Apple Loops."""
    destino = PUBLICO / "audio" / "musica" / f"{nombre}.wav"
    destino.parent.mkdir(parents=True, exist_ok=True)
    capas = [LOOPS / "Chill Chords Acoustic Guitar.caf", LOOPS / "Chill Chords Bass.caf"]
    if propia is not None:
        ffmpeg("-y", "-i", str(propia), "-vn", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", str(destino))
        capas = [propia]
    elif not destino.exists():
        convertidas = []
        for capa in capas:
            wav = TRABAJO / (normalizar_palabra(capa.stem) + ".wav")
            ejecutar("afconvert", "-f", "WAVE", "-d", "LEI16@48000", str(capa), str(wav))
            convertidas.append(wav)
        ffmpeg("-y", "-i", str(convertidas[0]), "-i", str(convertidas[1]),
               "-filter_complex", "amix=inputs=2:normalize=0", "-ar", "48000", "-c:a", "pcm_s16le", str(destino))
    loudness = float(medir_loudness(destino)["input_i"])
    bajo_db = nivel - loudness  # bajo la voz: -30 LUFS salvo que la skill «Sonido» pida otro nivel
    alto_db = bajo_db + 10     # sin voz: 10 dB más
    return {
        "archivo": f"audio/musica/{nombre}.wav",
        "capas": [capa.name for capa in capas],
        "loudness_base": loudness,
        "volumen_bajo": round(min(1.0, 10 ** (bajo_db / 20)), 4),
        "volumen_alto": round(min(1.0, 10 ** (alto_db / 20)), 4),
    }
