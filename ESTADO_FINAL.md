# Estado de Segmenta Studio

Actualizado el 6 de noviembre de 2026. Producción: https://studio.segmenta.online/

## Etapas

- [x] Repositorio y despliegue en Vercel.
- [x] Carga de varias tomas y exportación MP4 vertical en la versión web.
- [x] Línea de tiempo con orden, división, recorte, velocidad, volumen, color y edición de texto sobre el video.
- [x] Libreto para proponer el orden y recursos visuales.
- [x] Transcripción local en navegadores con WebGPU, tiempos de voz por palabra y corrección de subtítulos sin perder esos tiempos. También acepta SRT/VTT.
- [x] Rechazo de nuevos planes con subtítulos sin tiempos reales; validación técnica del MP4 al exportar.
- [ ] Validar una nueva exportación de E01 desde la sesión de Chrome que contiene las tomas del usuario. La sesión de revisión disponible muestra cero proyectos.
- [ ] Superposiciones de imágenes y B-roll real, música con licencia, composición a varias pistas, pantalla dividida y efectos contextuales.
- [ ] Evaluación editorial automática del MP4 (calidad narrativa, sincronía y diseño) con revisión humana.
- [ ] Conexión operativa de Codex, Claude y Gemini de escritorio con la web, sin claves API. Hoy la web no ejecuta esas aplicaciones como agentes.
- [ ] Reparar el despliegue automático desde GitHub: los dos últimos cambios de código se publicaron manualmente en Vercel porque el push no creó un despliegue nuevo.

## Lo que hacen las skills web ahora

Las skills son perfiles de edición y controles del render, no catorce agentes de IA independientes. Algunas se ejecutan, otras son parciales y otras siguen pendientes. La interfaz muestra ese estado. El motor aplica recortes de silencio, compresión de voz, zoom/color, rótulos, subtítulos temporizados, transiciones básicas y acentos sonoros procedimentales en cambios de escena. La disolución solicitada usa un fundido a negro.

El libreto ordena automáticamente las tomas y añade rótulos breves cuando la coincidencia con el texto hablado es suficientemente clara. Si el orden no es fiable, la persona conserva el control de la línea de tiempo. La transcripción local usa un modelo que se descarga en el navegador; requiere WebGPU, puede cometer errores y debe revisarse antes de exportar.

## Evidencia de esta entrega

- Git: `c59c9f4` en `main`.
- Vercel: `dpl_HHMT1QAdh38MrrNXNAkSo7Kt5iUA` promovido a `studio.segmenta.online`.
- `npm run build`, `npm run lint` y 28 pruebas completadas.
- La ruta de extracción de voz exige acceso al dueño de la toma. La respuesta sin sesión es 401.
- El MP4 anterior no se modifica automáticamente: hay que preparar y renderizar un trabajo nuevo.
