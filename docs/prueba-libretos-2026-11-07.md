# Prueba de libretos y rodaje · 7 de noviembre de 2026

Objetivo: subir un archivo de libretos, separarlo en carpetas/proyectos con escenas en orden y grabar cada toma en su escena. Sitio: https://studio.segmenta.online/. Aplicación canónica: apps/studio-web.

## Recorrido de la prueba

1. Entrar al portafolio y pulsar **Importar libretos**.
2. Seleccionar Word (.docx), PDF con texto, TXT o Markdown de hasta 4 MB. Hay una plantilla descargable dentro del importador.
3. Revisar las carpetas detectadas, sus escenas y las indicaciones. Editar nombres/texto u ordenar escenas si hace falta.
4. Pulsar **Crear carpetas y escenas**. Cada libreto se guarda como proyecto del portafolio autenticado.
5. Abrir una carpeta y pulsar una escena para activar la cámara. El texto aparece como teleprompter. Pulsar Grabar inicia el conteo.
6. Detener y elegir **Aprobar**, **Blooper** o **Repetir**. Aprobar guarda y avanza a la siguiente escena pendiente; Blooper conserva el error separado y mantiene la escena para repetirla.
7. Al finalizar, ir al editor para revisar las tomas y confirmar el orden del montaje.

Las carpetas son agrupaciones dentro de Studio, disponibles en la cuenta; no son directorios del teléfono. No se exige plan creativo previo para importar o grabar. La revisión de tomas y cronología antes de editar sigue siendo obligatoria.

## Implementado

- [x] Extracción local del documento, sin claves ni servicios de IA de pago.
- [x] Varios libretos por archivo: E01/E02, VIDEO 1/2, GUION 1/2 o encabezados Markdown.
- [x] Escenas por HOOK/DOLOR/VALOR/CTA o ESCENA; texto sin etiquetas se divide por párrafos.
- [x] Vista editable antes de crear; no se trunca el texto silenciosamente.
- [x] Metadatos conservados en el libreto del proyecto y fuera del teleprompter.
- [x] Propiedad de portafolio/proyecto/escenas comprobada en servidor.
- [x] Reintentos idempotentes: mismos IDs de importación y proyecto recuperan escenas faltantes sin duplicar ni sobrescribir tomas.
- [x] Destino de grabación fijado antes del conteo; navegación protegida durante captura, toma sin guardar y subida.
- [x] Reconexión de la cámara al volver de previsualización; cancelación de solicitudes y limpieza al salir.
- [x] Clave y takeId estables por Blob para reintentar subida/registro sin cruzar escenas.
- [x] MIME WebM con codecs normalizado correctamente.

## Evidencia y pendientes

- 111 pruebas automatizadas aprobadas; ESLint y compilación Next de producción aprobados.
- Prueba de interfaz Word: 2 carpetas / 7 escenas creadas con componentes, parser y persistencia reales contra repositorio local de prueba.
- Simulación de respuesta perdida tras guardar carpeta2: reintento recuperó exactamente2 carpetas /7 escenas.
- TXT, DOCX y PDF comprobados; PDF escaneado rechaza con explicación sin inventar texto.
- [x] MediaRecorder real con cámara sintética: MP4 aprobado de 28,7 s guardado en Gancho; avance a Problema. Segunda toma de 12,2 s guardada como Blooper en Problema sin avanzar. Cambio de pantalla durante captura bloqueado con aviso; cámara reconectada tras cada preview.
- [ ] Publicación y comprobación autenticada en producción.
- [ ] Prueba de cámara física en el teléfono que se usará mañana. Una cámara sintética no demuestra permisos/cámara/micrófono de iPhone o Android.

La fixture local está fuera del repositorio, en /tmp/segmenta-scripts-fixture (puerto8893). No utiliza datos ni almacenamiento de producción. Las evidencias deben identificar explícitamente si son de fixture o de producción.

## Límites

Máximo20 libretos por archivo,12 escenas por libreto,1000 caracteres por escena y6000 por libreto incluyendo indicaciones. PDF necesita texto seleccionable; no incluye OCR. El importador usa reglas de estructura, no promete interpretación generativa de documentos arbitrarios. No guardar credenciales, cookies, tokens o archivos privados en este repositorio.

## Continuación nocturna

Automatización en este chat: segmenta-prueba-de-libretos-para-ma-ana, cada hora hasta el7 de noviembre a las08:00 de Bogotá. Consultar este documento y el estado Git para continuar solo pendientes relevantes. Si todo está verificado, hacer una comprobación final del despliegue y pausar; no ampliar el alcance ni alterar videos existentes.
