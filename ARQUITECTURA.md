# Arquitectura

## Límites del sistema

`multiagent_core/` es independiente de Kiko Studio. Expone tareas, proyectos, proveedores, enrutamiento, costes y una cola recuperable. `kiko_studio/` consume ese núcleo y contiene solo capacidades propias de contenido y video. Cada registro incluye `project_id`; los artefactos de cada proyecto viven en rutas separadas.

## Flujo principal

1. El coordinador recibe un objetivo y lo convierte en tareas registradas.
2. La cola valida dependencias, permisos, intentos y presupuesto.
3. AI Router filtra por capacidad, modalidad, privacidad y disponibilidad; ordena por suficiencia, coste y latencia.
4. El adaptador ejecuta una herramienta local o una aplicación/CLI autorizada de Codex, Claude o Gemini.
5. AI Cost Controller guarda tokens, estimaciones, coste real disponible, duración, caché, resultado y error.
6. El resultado se registra como artefacto y desbloquea dependencias.
7. Las revisiones cruzadas solo se crean para riesgo alto, ambigüedad o cambio arquitectónico.

## Persistencia y recuperación

SQLite usa transacciones y modo WAL. Al reiniciar, una tarea que quedó `running` puede recuperarse a `pending` y conserva su historial. Los reintentos son finitos y los errores anteriores no se sobrescriben. Los videos originales se copian al almacén de importaciones; el motor solo escribe derivados y exportaciones.

## Seguridad

- Sin claves en el repositorio, logs ni base de datos.
- La configuración de Kiko Studio no utiliza claves API. Cualquier ruta facturable permanece bloqueada con presupuesto USD 0.
- Los comandos locales usan listas de argumentos, tiempos máximos y directorios delimitados.
- No hay automatización de interfaces web ni descarga no autorizada.
- Las tendencias aceptan fuentes del usuario, API oficial o conector autorizado y conservan la URL.
- El servidor escucha en `127.0.0.1` por defecto.

## Ejecución prolongada

La cola es recuperable, pero persistencia de datos no equivale a un ejecutor permanente. Una ejecución nocturna requiere un proceso autorizado (por ejemplo, un LaunchAgent configurado por el usuario) y que macOS no suspenda el equipo. El proyecto no instala ese mecanismo de forma silenciosa.

