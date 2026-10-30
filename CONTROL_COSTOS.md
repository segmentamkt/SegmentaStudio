# Control de costos

## Política vigente

- Claves API: no se usan.
- Presupuesto de APIs: USD 0.
- Codex, Claude y Gemini: únicamente mediante aplicaciones o sesiones autorizadas del usuario.
- Edición, verificación, tendencias, creatividad determinista y estilo: procesamiento local.
- No se triplican consultas mecánicas entre las tres IA.

MultiAgent Core conserva el controlador de presupuesto para impedir accidentalmente una ruta facturable. Con la configuración actual, cualquier proveedor que estime un costo mayor que cero queda bloqueado antes de ejecutar.

## Registro

Cada colaboración conserva proveedor, fase, duración, resultado y error. Cuando una aplicación no informa tokens, el valor se registra como desconocido; nunca se inventa un costo ni se interpreta una suscripción como crédito API.
