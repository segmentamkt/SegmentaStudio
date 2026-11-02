# Contrato de edición Kiko

El contrato `kiko.edit-contract.v1` es la fuente de verdad entre el director cloud y el motor local.

## Campos esenciales

- `objective`: propósito narrativo, no una lista de filtros.
- `ordered_clip_ids`: orden exacto de los clips que debe ejecutar el motor.
- `style`: preset editorial seleccionado por el usuario.
- `target_duration_seconds`: duración deseada después de cortes.
- `captions`: idioma, máximo de palabras por tarjeta y énfasis.
- `dead_air`: umbral a partir del cual debe cortarse silencio.
- `effects`: requisitos de transición, sonido, B-roll, etiquetas y música.
- `quality_gates`: condiciones obligatorias antes de entrega.

## Evidencia mínima del render

La compuerta final necesita valores medidos del archivo, no estimaciones:

- existencia y reproducción válida;
- duración real;
- ancho y alto;
- presencia de audio;
- número real de subtítulos;
- número real de efectos;
- segundos de silencio eliminados, cuando estén disponibles;
- ruta local del resultado.

Un trabajo en estado `queued`, `processing` o `rendering` nunca equivale a una edición terminada.
