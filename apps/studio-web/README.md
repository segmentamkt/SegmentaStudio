# Kiko Studio Cloud Camera

Aplicación privada para grabar contenido por escenas desde celular o computador, seguir el libreto con teleprompter y clasificar cada toma como aprobada, repetición o blooper.

## Funciones actuales

- Cámara y micrófono desde el navegador.
- Teleprompter con velocidad regulable.
- Grabación por escenas y orden del libreto.
- Aprobación, repetición y carpeta de bloopers.
- Portafolios independientes con identidad editorial.
- Sincronización entre celular y computador.
- Almacenamiento privado de videos en R2.
- Proyectos y estados persistentes en D1.
- Instalación como PWA en iPhone, Android y escritorio.
- MCP privado de dirección y validación editorial.

## Uso local

Requiere Node.js 22.13 o superior.

```bash
npm install
npm run db:generate
npm run build
npm start
```

La publicación oficial se administra con OpenAI Sites. Las credenciales, bases de datos y videos nunca se guardan en este repositorio.

## Arquitectura

- React 19 y Vinext para la interfaz.
- Cloudflare Workers para las rutas privadas.
- D1 para cuentas, portafolios, escenas y tomas.
- R2 para los archivos de video.
- ChatGPT Sign-In para proteger cada cuenta.

## Estado del producto

La cámara cloud y la organización de tomas son funcionales. El render profesional con cortes, subtítulos, efectos y mezcla final continúa en el motor de edición de Kiko Studio y será la siguiente etapa de migración a procesamiento cloud.
