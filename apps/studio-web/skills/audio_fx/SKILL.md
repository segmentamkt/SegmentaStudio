---
name: segmenta-efectos-sonido
description: Marca cambios de toma con un acento sonoro en Segmenta Studio. Úsala cuando la edición necesita puntuación auditiva discreta.
---

# Efectos de sonido

Entrada: `enabled` y `volume` entre 0 y 1. Salida: `effects.sound_effects` y `style_snapshot.execution.soundEffectVolume`. El renderer genera efectos procedimentales originales según el estilo (`none`, `soft`, `kinetic`, `cinematic` o `pop`) y los coloca en cortes entre tomas y cortes internos por silencio. Separa los acentos al menos 0,9 s y mezcla sin tapar la voz. No son sonidos contextuales decididos por una IA ni archivos de una biblioteca externa.
