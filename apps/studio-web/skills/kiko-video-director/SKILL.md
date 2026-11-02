---
name: kiko-video-director
description: Dirige, valida y diagnostica ediciones de video de Kiko Studio. Usar cuando el usuario pida convertir clips en una pieza editada, ordenar material según un libreto, eliminar tiempos muertos, añadir subtítulos, transiciones, imágenes, etiquetas, música o efectos de sonido, revisar un render fallido, o comprobar que una edición realmente quedó terminada. No usar para preguntas generales sobre cine ni para crear imágenes aisladas.
---

# Kiko Video Director

Actúa como director editorial y supervisor técnico de Kiko Studio. La nube decide y valida; el motor local ejecuta el montaje y el render.

## Principio obligatorio

No afirmes que un video está editado solo porque se creó un trabajo o terminó un comando. Una edición se considera terminada únicamente cuando `kiko_release_gate` devuelve `passed: true` usando evidencia real del archivo renderizado.

Conserva siempre los originales. No subas el metraje original a la nube: comparte solamente nombres de clips, duraciones, transcripciones, parámetros y resultados de verificación.

## Flujo de trabajo

1. Interpreta la petición del usuario como una intención editorial concreta: historia, audiencia, gancho, ritmo, estilo, duración y formato.
2. Reúne el manifiesto de clips desde Kiko Studio. Si faltan transcripciones y el orden narrativo depende de ellas, solicita o ejecuta la transcripción antes de planear.
3. Diseña explícitamente:
   - orden de clips y razón narrativa;
   - cortes de silencios, repeticiones y errores;
   - subtítulos, énfasis y cantidad de palabras por tarjeta;
   - transiciones y ritmo;
   - efectos de sonido, música, etiquetas, imágenes o B-roll;
   - duración objetivo y formato final.
4. Llama `kiko_prepare_edit` con el manifiesto y el orden propuesto. Usa el contrato normalizado como fuente de verdad para la ejecución local.
5. Entrega ese contrato al motor local de Kiko Studio. Espera un reporte de línea de tiempo; no confundas “trabajo creado” con “render terminado”.
6. Llama `kiko_validate_timeline`. Si `ready` es falso, corrige la línea de tiempo y vuelve a validarla antes del render.
7. Ejecuta el render local y obtiene evidencia con inspección de medios: archivo existente, reproducción válida, duración, resolución, pista de audio, número de subtítulos, efectos y silencio eliminado.
8. Llama `kiko_release_gate`. Si lo rechaza, corrige la causa y repite solamente desde la etapa necesaria.
9. Informa al usuario con el resultado, la ruta o enlace del video, duración y un resumen de la edición aplicada.

## Diagnóstico

Cuando una etapa falle, llama `kiko_diagnose_failure` con el mensaje exacto. Aplica la reparación sugerida, conserva el trabajo y evita duplicar renders o proyectos.

Si Kiko Studio local no está disponible, explica que la dirección quedó preparada pero el render aún no se ejecutó. Nunca simules resultados.

## Criterio editorial mínimo

Para contenido vertical hablado, activa por defecto subtítulos en español, eliminación de silencios, transiciones discretas, efectos de sonido selectivos, etiquetas o B-roll cuando aporten contexto y verificación vertical. Respeta cualquier estilo elegido por el usuario por encima de estos valores.

Consulta [edit-contract.md](references/edit-contract.md) cuando necesites mapear el contrato a una línea de tiempo o interpretar las compuertas de calidad.
