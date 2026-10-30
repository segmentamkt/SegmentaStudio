# Contrato de edición Kiko

El contrato `kiko.edit-contract.v1` es la fuente de verdad entre el director cloud y el motor local.

## Campos esenciales

- `objective`: propósito narrativo.
- `ordered_clip_ids`: orden exacto de los clips.
- `style`: preset editorial elegido.
- `target_duration_seconds`: duración deseada después de cortes.
- `captions`: idioma, palabras por tarjeta y énfasis.
- `dead_air`: umbral para cortar silencios.
- `effects`: transiciones, sonido, B-roll, etiquetas y música.
- `quality_gates`: condiciones obligatorias antes de entrega.

## Evidencia mínima

La compuerta final usa valores medidos del archivo: reproducción, duración, dimensiones, audio, subtítulos, efectos, silencio eliminado y ruta local. Los estados `queued`, `processing` o `rendering` nunca equivalen a una edición terminada.
