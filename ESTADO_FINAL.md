# Estado final

Actualizado el 25 de octubre de 2026.

## Funcional

- Panel privado en `http://127.0.0.1:8765` con proyectos, biblioteca de videos, tendencias, ideas, estilo, equipo IA y tareas.
- Carga real de MP4/MOV desde el navegador, copia intacta del original y rutas aisladas por proyecto.
- Edición nativa con AVFoundation: exportación vertical 1080 × 1920, marco morado, texto opcional, conservación del audio existente y MP4 H.264 reproducible.
- Validación del archivo exportado antes de marcarlo como listo, reproducción y apertura del original/resultado desde el panel.
- Radar manual de referencias con URL verificable, procedencia y métricas solo si llevan evidencia.
- Generación creativa local de ideas, hooks, guion, notas de grabación y CTA.
- Preferencias de estilo persistentes, historial y reversión segura.
- MultiAgent Core con cola durable, router, caché, recuperación, fencing tokens, telemetría y colaboración por propuestas, revisión cruzada e integración.
- Adaptadores de Codex, Claude y Gemini por CLI o aplicación autorizada. El sistema no cuenta una app instalada como ejecución real.

## Regla de proveedores

No se usan claves API ni facturación por tokens. Codex, Claude y Gemini participan mediante sus aplicaciones o sesiones autorizadas en el Mac. La edición mecánica se ejecuta localmente, porque no necesita un modelo de lenguaje.

## Límites transparentes

- La detección automática de silencios requiere FFmpeg, que no está instalado. El resto del flujo usa AVFoundation y funciona sin FFmpeg.
- La transcripción automática local no está habilitada; el texto en pantalla se proporciona en el formulario. No se envía el video a una API.
- El panel no publica en redes ni descarga contenido de terceros.
- No existe un worker nocturno configurado; la cola conserva el estado, pero el Mac debe permanecer activo y la aplicación abierta para ejecutar trabajo.

## Resultado probado

Se importó un MP4 real, se procesó desde la misma API del panel, se exportó a 1080 × 1920 con texto, se volvió a descargar y AVFoundation confirmó `playable = true`.
