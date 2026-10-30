"""Efectos de sonido sintetizados en local (creación propia, sin licencias de terceros).

Son provisionales: sirven para validar sincronía y niveles. Si grabas los sonidos reales
(teclado, teléfono vibrando, moneda cayendo) basta con reemplazar el WAV del mismo nombre.
"""

from __future__ import annotations

import math
import random
import struct
import wave
from pathlib import Path

RATE = 48_000


def _write(path: Path, samples: list[float], peak_dbfs: float) -> None:
    peak = max(1e-9, max(abs(value) for value in samples))
    gain = 10 ** (peak_dbfs / 20) / peak
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(b"".join(struct.pack("<h", int(32767 * value * gain)) for value in samples))


def _lowpass(samples: list[float], cutoff: float) -> list[float]:
    alpha = 1 - math.exp(-2 * math.pi * cutoff / RATE)
    state, result = 0.0, []
    for value in samples:
        state += alpha * (value - state)
        result.append(state)
    return result


def whoosh(rng: random.Random, seconds: float = 0.45) -> list[float]:
    count = int(RATE * seconds)
    state, result = 0.0, []
    for index in range(count):
        t = index / count
        cutoff = 300 + 3700 * math.sin(math.pi * t) ** 1.5
        alpha = 1 - math.exp(-2 * math.pi * cutoff / RATE)
        state += alpha * (rng.uniform(-1, 1) - state)
        result.append(state * math.sin(math.pi * t) ** 2)
    return result


def ovacion(rng: random.Random, seconds: float = 0.9) -> list[float]:
    count = int(RATE * seconds)
    bed = _lowpass([rng.uniform(-1, 1) for _ in range(count)], 1500)
    claps = [0.0] * count
    for _ in range(int(seconds * 140)):
        start = rng.randrange(count)
        length = int(RATE * rng.uniform(0.004, 0.012))
        amplitude = rng.uniform(0.3, 1.0)
        for offset in range(min(length, count - start)):
            claps[start + offset] += amplitude * rng.uniform(-1, 1) * math.exp(-offset / (length / 3))
    claps = _lowpass(claps, 2800)
    envelope = [min(1.0, index / (0.08 * RATE)) * min(1.0, (count - index) / (0.35 * RATE)) for index in range(count)]
    return [(0.35 * bed[index] + claps[index]) * envelope[index] for index in range(count)]


def clic(rng: random.Random) -> list[float]:
    count = int(RATE * 0.03)
    return [
        (0.6 * rng.uniform(-1, 1) * math.exp(-index / 60) + math.sin(2 * math.pi * 2900 * index / RATE) * math.exp(-index / 180))
        for index in range(count)
    ]


def vibracion(seconds: float = 0.7) -> list[float]:
    count = int(RATE * seconds)
    result = []
    for index in range(count):
        t = index / RATE
        pulse = 1.0 if t < 0.3 or 0.4 <= t < 0.7 else 0.0
        local = t if t < 0.3 else t - 0.4
        envelope = pulse * min(1.0, local / 0.02) * min(1.0, (0.3 - local) / 0.03 if local < 0.3 else 0)
        tone = sum(math.sin(2 * math.pi * 170 * harmonic * t) / harmonic for harmonic in (1, 2, 3, 5))
        result.append(tone * envelope * (0.85 + 0.15 * math.sin(2 * math.pi * 23 * t)))
    return result


def ping(seconds: float = 0.6) -> list[float]:
    count = int(RATE * seconds)
    partials = ((2093, 1.0, 0.18), (3320, 0.6, 0.12), (5150, 0.4, 0.07), (7020, 0.25, 0.04))
    return [
        sum(amplitude * math.sin(2 * math.pi * frequency * index / RATE) * math.exp(-index / (decay * RATE))
            for frequency, amplitude, decay in partials)
        for index in range(count)
    ]


def pop(seconds: float = 0.12) -> list[float]:
    """Burbuja corta para íconos: seno con caída de tono."""
    count = int(RATE * seconds)
    fase, result = 0.0, []
    for index in range(count):
        t = index / count
        fase += 2 * math.pi * (900 - 500 * t) / RATE
        result.append(math.sin(fase) * math.exp(-5 * t) * min(1.0, index / 48))
    return result


def impacto(rng: random.Random, seconds: float = 0.35) -> list[float]:
    """Golpe grave y suave para texto cinético."""
    count = int(RATE * seconds)
    ruido = _lowpass([rng.uniform(-1, 1) for _ in range(count)], 400)
    fase, result = 0.0, []
    for index in range(count):
        t = index / RATE
        fase += 2 * math.pi * (110 - 60 * min(1.0, t / 0.2)) / RATE
        result.append((math.sin(fase) + 0.4 * ruido[index]) * math.exp(-t / 0.09) * min(1.0, index / 96))
    return result


EFECTOS = {
    "pop": (lambda rng: pop(), -20),
    "impacto": (lambda rng: impacto(rng), -20),
    "whoosh": (lambda rng: whoosh(rng), -18),
    "ovacion": (lambda rng: ovacion(rng), -24),
    "clic": (lambda rng: clic(rng), -22),
    "vibracion": (lambda rng: vibracion(), -22),
    "ping": (lambda rng: ping(), -18),
}


def generar(destino: Path, *, sobrescribir: bool = False) -> dict[str, str]:
    """Crea los WAV que falten; respeta los que el usuario haya reemplazado con grabaciones propias."""
    destino.mkdir(parents=True, exist_ok=True)
    rutas = {}
    for nombre, (fabrica, pico) in EFECTOS.items():
        ruta = destino / f"{nombre}.wav"
        if sobrescribir or not ruta.exists():
            _write(ruta, fabrica(random.Random(nombre)), pico)
        rutas[nombre] = str(ruta)
    return rutas
