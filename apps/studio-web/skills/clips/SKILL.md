---
name: segmenta-clips
description: Planifica clips cortos derivados de un video largo para Segmenta Studio. Úsala cuando el creador quiera seleccionar momentos completos para Reels o Shorts.
---

# Clips de un video largo

Entrada: video largo, libreto o transcripción, duración objetivo y criterio editorial. Salida actual: solicitud en `skill_manifest`. No extrae ni renderiza clips automáticamente en Vercel. Implementar esta skill exige transcripción con tiempos, selección de segmentos, vista previa y trabajos de render independientes.
