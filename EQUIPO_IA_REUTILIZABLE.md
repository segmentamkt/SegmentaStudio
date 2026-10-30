# Equipo IA reutilizable

## Crear otro proyecto

1. Registra un proyecto con identificador único, objetivo, contexto permitido y presupuesto.
2. Declara entregables como tareas pequeñas con dependencias explícitas.
3. Habilita solo proveedores auditados; deja los demás en modo pendiente.
4. Define capacidades necesarias y umbral de calidad, no una marca favorita.
5. Ejecuta la cola en modo supervisado al principio.
6. Comprueba artefactos y pruebas antes de confirmar decisiones o habilitar automatización.

## Contrato de un proveedor

Un adaptador declara identificador, capacidades, modalidades, disponibilidad, estimación de coste y una operación de ejecución que devuelve resultado y medición. Sustituir un modelo no cambia la cola ni los proyectos. Los stubs nunca fingen una respuesta: si falta autenticación, fallan de forma explícita antes de consumir.

## Segundo caso de prueba

El proyecto ficticio incluido en la validación debe usar un identificador y datos distintos de Kiko Studio. La prueba comprueba que cola, enrutamiento, persistencia y costes funcionan sin importar módulos audiovisuales ni mezclar artefactos.

