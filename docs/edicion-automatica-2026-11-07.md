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
