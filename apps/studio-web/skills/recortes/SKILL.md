---
name: segmenta-recortes
description: Detecta silencios largos y define cortes para videos hablados en Segmenta Studio. Úsala para quitar tiempos muertos de tomas aprobadas.
---

# Recortes y silencios

Entrada: audio de cada toma, `removeSilence` y `thresholdMs` entre 350 y 1500. La salida escribe `dead_air.remove` y `dead_air.threshold_ms` en el contrato. El renderer usa FFmpeg `silencedetect`, conserva margen alrededor del silencio y concatena tramos.

No confundas detección de silencio con detección de errores, repeticiones o muletillas: eso exige transcripción alineada y revisión semántica.
