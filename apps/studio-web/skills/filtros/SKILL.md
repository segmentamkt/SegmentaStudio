---
name: segmenta-color
description: Ajusta la saturación de videos en Segmenta Studio. Úsala para mantener un color consistente en una producción.
---

# Color

Entrada: `saturation` entre 0,7 y 1,4. Salida: `style_snapshot.execution.saturation`. El renderer lo aplica con el filtro `eq` de FFmpeg. Esta skill no promete LUTs, corrección automática de piel ni etalonaje por escenas.
