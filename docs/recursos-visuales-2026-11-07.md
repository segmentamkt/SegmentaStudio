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

- Commit funcional `18f45d6`, Vercel producción correcto en `studio.segmenta.online`.
- Proyecto existente «Edición de 12 videos», 11 segmentos aprobados; se conservaron los originales y la exportación anterior.
- Detectó cuatro apoyos: habilidad/crecimiento, miedo, dinero e ideas. Se probó reemplazar uno por un PNG importado (normalizado a WebP), ajustar tiempos/encuadre y recargar: persistió correctamente. La imagen importada también pasó el render cloud real.
- «Editar automáticamente» completó las cinco etapas y mostró imágenes contadas en muestras reales. MP4 `628efe2d-8a68-429a-8dc0-7fa53afe2020` disponible en Mis videos, sin sustituir el MP4 anterior.
- Contadores: 88,7 s finales, 56 tarjetas de subtítulos, 10 sonidos y 4 imágenes; 25,6 s de silencio retirado. Archivo descargado: 88,901 s, H.264 1080×1920, AAC estéreo, decodificación completa exit 0, volumen medio −26,9 dB.
- Fotogramas reales verificados: imagen de crecimiento a 1,2 s, miedo a 29,4 s, dinero a 40 s e ideas a 76,5 s; imagen ausente a 4 s tras su intervalo. Subtítulos visibles y voz conservada. `kiko_release_gate`: `passed:true`.
- Evidencia local en `artifacts/visual-resources-2026-11-07/`; no se suben los fotogramas ni videos personales a GitHub.
- Ajuste final de interfaz: panel con desplazamiento limitado para evitar alejar el reproductor y «Ver en el video» centra el reproductor.

## Límites reales

La selección automática usa coincidencias de palabras contra este catálogo inicial; no interpreta cualquier concepto ni genera nuevas imágenes a demanda. Depende de la precisión de los subtítulos. Se conserva la posibilidad de reemplazar o quitar cualquier apoyo. Las ilustraciones son conceptuales, no fotografías de los eventos narrados. Se comprobó navegador de escritorio; no se afirma una prueba física de cámara ni de teléfono en esta etapa. Los borradores siguen sujetos al almacenamiento de este navegador si la instalación utiliza planes efímeros.
