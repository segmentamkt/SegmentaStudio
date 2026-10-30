# Validación multiagente

## Proveedores autorizados

| Recurso | Instalado | Sesión verificada | Uso en el proyecto |
|---|---:|---:|---|
| Codex / ChatGPT | Sí | Sí | Coordinación, implementación e integración |
| Claude Desktop | Sí | Sí | Revisión de concurrencia, privacidad, presupuesto e idempotencia |
| Gemini Desktop | Sí | Sí | Revisión de arquitectura, criterios de prueba y adjudicación técnica |

No se utilizaron `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` ni `GEMINI_API_KEY`. Claude Code está instalado pero su CLI no tiene sesión; Gemini CLI está instalado dentro del proyecto pero requiere iniciar sesión. Esto no impide la colaboración mediante las aplicaciones nativas ya autorizadas.

## Rondas comprobadas

1. **Trabajo independiente:** Codex implementó el núcleo, el panel y la integración; Claude y Gemini evaluaron riesgos y prioridades por separado.
2. **Revisión cruzada:** Claude revisó propuestas de Gemini y Codex; Gemini recibió y adjudicó las correcciones de Claude.
3. **Integración:** Codex implementó WAL, `BEGIN IMMEDIATE`, `synchronous=FULL`, reloj de SQLite, leases con fencing token, diagnósticos honestos y pruebas.

Evidencia narrativa original: `logs/providers/colaboracion_apps_2026-10-25.md`.

## Coordinador reusable

`MultiAgentCollaborator` registra en SQLite cada propuesta, revisión, integración, error, duración y resultado. Si menos de dos proveedores responden, guarda `insufficient_contributors`; nunca inventa consenso. Los adaptadores de aplicaciones requieren autorización explícita y los adaptadores CLI ejecutan sin shell, con tiempo máximo y límite de salida.

## Criterio honesto

Una aplicación abierta o un ejecutable instalado no cuentan como colaboración. Solo una respuesta obtenida para una tarea solicitada puede registrarse como contribución. El panel muestra disponibilidad de las apps, mientras el núcleo conserva la evidencia de cada ronda ejecutada.
