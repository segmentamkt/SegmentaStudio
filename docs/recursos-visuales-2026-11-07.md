# Imágenes relacionadas con la voz — 7 de noviembre de 2026

## Implementación

- «Editar automáticamente» reconoce la voz, detecta conceptos del catálogo en subtítulos temporizados, coloca apoyos y los incorpora al MP4. No requiere libreto ni un nuevo paso de aprobación.
- Pestaña **Recursos**: palabra detectada, toma, inicio/final, encuadre pequeño/grande, vista previa, biblioteca, foto propia, reemplazo y eliminación. Respeta imágenes editadas o descartadas; undo/redo, recortes, división y duplicación conservan los intervalos correctos.
- Catálogo inicial: dinero, ideas, tiempo, crecimiento, trabajo y miedo; ilustraciones generadas con imagegen. Detección acotada por palabras, sin modelo generativo remoto en la plataforma. Fotos propias admitidas para otros temas.
- PNG/JPEG/WebP propios se reducen en el navegador; servidor valida formato raster, píxeles, tamaño, tiempos y cantidades. Sin URLs remotas, SVG del usuario, claves nuevas ni APIs de pago.
- Hasta 2 imágenes por segmento y 8 por montaje; 0,1–12 s de fuente por imagen. El render ajusta tiempos según silencios y velocidad. Subtítulos y rótulos encima de las imágenes.
- Opciones, imágenes y decisiones manuales se guardan en el borrador y contrato. Aviso visible si el navegador no puede guardar el borrador por falta de espacio. Los originales se conservan.

## Pruebas

172 pruebas locales aprobadas, ESLint y compilación de producción correctos. Incluyen normalización, límites, recuperación del borrador, decisiones manuales, ASR → recursos → plan → render, cancelación y renders FFmpeg reales con silencios/velocidad/subtítulos/voz. Los seis PNG se validaron con el cargador real en ambos encuadres.

## Verificación de producción

Pendiente del despliegue de esta etapa y de generar/comprobar el MP4 con el proyecto existente. No se considera probado con metraje real hasta completar esa evidencia.
