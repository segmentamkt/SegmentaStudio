---
name: segmenta-sonido
description: Supervisa claridad de voz y música de fondo en Segmenta Studio. Úsala cuando la edición requiera voz consistente o una pista musical.
---

# Sonido y voz

Entrada: audio de tomas aprobadas y solicitud de música.

## Volumen de entrega (siempre activo)

El render en serie (`lib/sequential-cloud-video-renderer.ts`) deja cada toma a **−14 LUFS integrados**, el nivel habitual de los reels:

1. La voz pasa por una compresión suave (umbral −18 dB, relación 2:1) a velocidad 1,0×.
2. Se mide la mezcla final de la toma (voz + acentos) con `loudnorm` en una pasada previa, sin codificar video.
3. Se aplica una sola ganancia estática hasta −14 LUFS (máximo +18 dB, mínimo −12 dB, para no subir a ciegas el ruido de una toma casi muda) y un limitador de picos a −1 dBFS.

Cada toma queda al mismo nivel aunque venga de otro teléfono o de WhatsApp. El resultado de la exportación informa por toma el volumen medido y la ganancia aplicada (`audio_loudness`). Una toma en silencio no se amplifica.

Desactivar esta skill no desactiva el volumen de entrega. Guarda la solicitud de música en el manifiesto, pero no anuncies música mezclada sin una pista autorizada y una mezcla verificable.
