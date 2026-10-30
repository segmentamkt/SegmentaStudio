# Matriz de modelos y herramientas

| Clase | Uso recomendado | Coste | Privacidad | Evidencia necesaria |
|---|---|---:|---|---|
| Código local determinista | FFmpeg, metadatos, cortes, caché, validación | $0 | Alta | Código de salida y artefacto |
| Modelo local | Clasificación o borrador cuando la calidad sea suficiente | $0 incremental | Alta | Modelo instalado y prueba real |
| Modelo económico remoto | Ideación, resumen, extracción estructurada | Variable | Media | API autenticada, tokens y coste |
| Modelo avanzado remoto | Decisiones complejas, multimodal, revisión crítica | Mayor | Media | Mejora medida que justifique escalado |
| Agente de código | Implementación y cambios de repositorio | Según acceso | Según servicio | Comando, diff y pruebas |

AI Router no fija ganadores por marca. La auditoría documenta por separado qué CLI o API está realmente disponible. Las puntuaciones iniciales son configuración, no resultados de un benchmark; deben sustituirse por evaluaciones representativas antes de tomar decisiones de producción.

## Acceso verificado el 25 de octubre de 2026

| Proveedor | Acceso | Modelo observado | Ejecución real |
|---|---|---|---|
| Codex | Aplicación + CLI autenticada con ChatGPT | `gpt-5.6-sol` en ejecución aislada | Sí |
| Anthropic | Claude Desktop y Claude Code autenticados | Opus 5.5 Medio en app; Sonnet 5.5 en CLI | Sí |
| Google | Gemini Desktop y Antigravity CLI autenticados | Flash Alto en app; Gemini 3.8 Flash High en CLI | Sí |
| Ollama | No instalado | — | No |

La colaboración final solicitada se hizo en las aplicaciones de escritorio de Gemini y Claude. Las CLIs quedaron como evidencia adicional de autenticación y automatización futura, no como sustituto de las apps.

## Criterios

Filtrado obligatorio: capacidad, modalidad, privacidad, disponibilidad y presupuesto. Ordenación: herramienta determinista antes que LLM; luego suficiencia de calidad, coste esperado, latencia y tasa histórica de éxito. El escalado ocurre solo tras fallo, calidad inferior al umbral o necesidad que el candidato barato no cubre.

