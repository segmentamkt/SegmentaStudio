# Segmenta Studio como monorepositorio

GitHub es la fuente de verdad. Cada aplicación, servicio, paquete, skill y complemento tiene una ruta, una versión y una validación verificable.

## Estructura

- `apps/`: interfaces web y móvil.
- `services/`: edición, render y trabajos prolongados.
- `packages/`: código compartido.
- `skills/`: instrucciones editoriales versionadas.
- `plugins/`: adaptadores para Codex, ChatGPT y MCP.
- `.github/workflows/`: validaciones automáticas.

Las carpetas históricas siguen funcionando. `workspace.json` declara su destino para una migración sin interrupciones.

Cada skill vive en `skills/<slug>/`, contiene `SKILL.md` y `manifest.json`, y aparece en `skills/registry.json`.

Ejecuta `python3 scripts/validate_monorepo.py` antes de publicar cambios.
