# Corrección de edición automática — 7 de noviembre de 2026

Caso observado en Chrome: «Edición de 12 videos», 11 segmentos incluidos, 10 con subtítulos. La toma restante muestra «La transcripción local admite tomas de hasta 2 minutos». Ese mensaje también se emitía cuando la duración guardada era cero.

## Corrección

- Medir la duración faltante del archivo antes de transcribir; expandir únicamente el recorte provisional de 0,2 s. Conservar correcciones, recortes deliberados, selección y orden.
- Reparar la duración guardada con propietario verificado; conservar el mismo recibo aprobado solo si no cambió ningún otro campo revisado, mediante comparación antes/después y actualización condicional.
- Extraer y transcribir intervalos acotados del recorte, con tiempos absolutos y caché de ventanas completadas para los reintentos.
- Permitir fuentes largas si el montaje final cabe en los 120 s disponibles. Analizar y codificar el intervalo seleccionado, incluso después del minuto dos.
- Continuar subtítulos → plan → render sin recargas intermedias que cancelen el proceso. Un fallo del almacenamiento local no convierte un resultado del servidor en un error.

## Evidencia local

135/135 pruebas aprobadas; ESLint y compilación de producción correctos. FFmpeg probado con fuente de 155 s, extracción desde 151 s; render desde 125 s con silencio eliminado, dos subtítulos, voz y fotogramas del intervalo correcto. No se usaron servicios de pago.

## Límites conservados

Montaje final máximo 120 s y 12 segmentos, render máximo 48 MB. No se elimina material para forzar esos límites. Las palabras reconocidas pueden requerir corrección. La comprobación con el proyecto real en producción se registra después del despliegue; las pruebas sintéticas no sustituyen esa evidencia.

## Producción verificada

- `30a660e` y `d4f7f01`: despliegues Vercel confirmados como correctos; sitio `https://studio.segmenta.online/`.
- Fuente pendiente real: 6,3 s, aunque el borrador antiguo mostraba 0,2 s. La reparación del servidor conservó la revisión del orden.
- Chrome conservaba sus 10 subtítulos, pero su control remoto no respondió a la recarga. Se validó desde la sesión autenticada del navegador integrado, con el mismo material y orden, sin sobrescribir el borrador de Chrome. Durante el cambio de versiones se corrigió allí el recorte provisional antiguo que ya había sido guardado; el segundo commit cubre la restauración desde borradores con duración provisional.
- Prueba real: 11 segmentos subtitulados → plan → render completo. MP4 `e88d7fed-64f3-488f-9163-bc704320b9f4`, visible en Mis videos / Resultados editados / Edición guardada (07:02 Bogotá).
- Resultado reportado: 88,7 s de montaje, 56 tarjetas de subtítulos, 10 efectos, 25,6 s de silencio retirado. Contenedor descargado: 88,901 s, 24.447.366 bytes, H.264 1080×1920 y AAC estéreo.
- Decodificación completa de imagen y audio: exit 0. Fotogramas comprobados en 3, 37 y 75 s. `kiko_release_gate` devuelve `passed:true`.
- Evidencia y fotogramas se conservan localmente en `artifacts/automatic-edit-2026-11-07/`; el video descargado está en Downloads. No se suben estos archivos personales al repositorio.
- Límites reales: se verificó funcionamiento/exportación, no perfección lingüística del ASR. Hay palabras que requieren revisión; tampoco se verificó el clic final dentro del borrador original de Chrome porque su control remoto no respondió.
