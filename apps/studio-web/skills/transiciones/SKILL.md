---
name: segmenta-transiciones
description: Elige cortes, fundidos y disoluciones entre tomas en Segmenta Studio. Úsala al configurar el ritmo visual de una edición.
---

# Transiciones

Entrada: `type` (`cut`, `fade`, `dissolve`) y `duration` entre 0,08 y 0,8 segundos. Salida: `effects.transitions`, `style_snapshot.transition` y `.transitionDuration`. El renderer aplica `xfade` y `acrossfade` entre tomas cuando la transición no es corte directo.
