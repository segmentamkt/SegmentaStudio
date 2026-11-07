# Cámara directa, galería y segmentación — 7 de noviembre de 2026

## Resultado implementado

- «Grabar ahora» y «Grabar» abren cámara/micrófono desde un clic y preparan una carpeta con una escena, sin formulario ni libreto. Grabar requiere pulsar el control de grabación.
- La carpeta se crea una sola vez por solicitud. Los reintentos y las respuestas perdidas recuperan el mismo destino sin sobrescribir proyectos existentes.
- Al detener: repetir, guardar como blooper, guardar pendiente en la galería o aprobar y pasar a segmentación.
- La subida conserva el destino capturado al empezar, usa el flujo TUS existente y no descarta el video local si falla el guardado.
- La galería muestra todas las tomas con reproducción, estado, copia al dispositivo y «Recortar y dividir» por toma.
- La selección de galería abre esa toma en la línea de tiempo manual después de la revisión obligatoria de clasificación/orden. No dispara una edición automática ni sustituye el original.
- Copia inmediata desde la grabación recién guardada; desde la galería: «Preparar copia» y luego «Guardar en dispositivo», conservando el gesto del usuario requerido por el menú de compartir.
- No hay cambios de esquema, nuevas claves, servicios de pago ni cambios de acceso.

## Validación realizada

- 198 pruebas aprobadas (26 nuevas para destino idempotente, aislamiento, copia y descarga acotada); ESLint y compilación de producción aprobados.
- Flujo UI local con los componentes reales y MediaRecorder real sobre cámara de canvas y audio sintéticos. Transporte de almacenamiento/autenticación simulado, persistencia en archivos locales.
- Grabación de 6,98 s → guardar pendiente → galería → descargar → recargar → aprobar/confirmar → abrir controles de la toma → dividir a los 3 s → recargar: los dos segmentos permanecen.
- Una carpeta, una escena, una toma y una subida tras el recorrido; el original se conserva en la galería.
- Descarga inmediata y descarga posterior desde la galería tienen SHA-256 idéntico. Decodificación completa exitosa: H.264 720×1280 con audio Opus en MP4.
- Vista móvil a 390×844: ancho del documento 390 px, sin desbordamiento horizontal; controles de segmentación visibles.
- Evidencia visual local en `artifacts/camera-gallery-2026-11-07/` (excluida de Git); fixture aislada en `/tmp/segmenta-direct-camera-fixture`.

## Límites reales

- No se ha grabado con una cámara física de iPhone/Android en esta prueba. Tampoco se ha verificado físicamente «Guardar video» en Fotos/Galería.
- La web puede abrir el menú de compartir o descargar; no puede elegir automáticamente Fotos/Galería ni confirmar ese destino. El navegador, códec y sistema operativo determinan las opciones.
- La preparación de copias de la galería está limitada a 100 MiB para evitar agotar la memoria del celular. Los archivos mayores pueden guardarse desde las opciones del reproductor si el navegador lo permite.
- Los recortes se guardan como borrador en este navegador y se aplican al siguiente render. El archivo original y su clasificación se conservan en Studio.
- La prueba local no acredita RLS, TUS ni cámara física en producción. Se reutilizan las rutas de subida existentes; la nueva ruta de destino verifica sesión y propietario.

## Publicación

Pendiente de registrar la comprobación del despliegue de esta entrega.
