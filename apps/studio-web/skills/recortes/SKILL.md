---
name: segmenta-recortes
description: Detecta silencios largos y define cortes para videos hablados en Segmenta Studio. Úsala para quitar tiempos muertos de tomas aprobadas.
---

# Recortes y silencios

Entrada: audio de cada toma, `removeSilence`, `mode` y `thresholdMs` entre 350 y 1500. La salida escribe `dead_air.remove`, `dead_air.mode` y `dead_air.threshold_ms` en el contrato.

- Modo **compacto**: FFmpeg `silencedetect` con umbral fijo; deja 0,1 s a cada lado de cada silencio largo.
- Modo **natural**: delega en la skill independiente [Cortes y pausas](../cortes-pausas/SKILL.md) (sin cuenta regresiva ni colas, pausas ≤ 0,7 s intactas, largas a 0,45 s, detección de voz adaptativa).

No confundas detección de silencio con detección de errores, repeticiones o muletillas: eso exige transcripción alineada y revisión semántica.
