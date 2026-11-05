---
name: segmenta-sonido
description: Supervisa claridad de voz y música de fondo en Segmenta Studio. Úsala cuando la edición requiera voz consistente o una pista musical.
---

# Sonido y voz

Entrada: audio de tomas aprobadas y solicitud de música.

El renderer actual aplica `loudnorm` a cada tramo de voz. Guarda la solicitud de música en el manifiesto, pero no anuncies música mezclada sin una pista autorizada y una mezcla verificable. Desactivar esta skill no desactiva la normalización base del motor.
