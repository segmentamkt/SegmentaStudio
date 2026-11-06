# Segmenta Studio

Editor de video vertical para [studio.segmenta.online](https://studio.segmenta.online), publicado desde [SegmentaStudio](https://github.com/segmentamkt/SegmentaStudio) en Vercel.

## Lo que funciona

- Grabación desde cámara y teleprompter; importación directa de varios videos como pendientes de revisión.
- Revisión obligatoria antes del editor: reproducir y clasificar todas las tomas como aprobadas, descartadas o bloopers, ordenar las aprobadas y confirmar. La selección se guarda en nube y el plan y el render verifican que siga vigente. Agregar, eliminar o reclasificar material obliga a revisarlo de nuevo. Descartar o enviar a bloopers conserva los originales; también se puede guardar una clasificación sin ninguna aprobada y volver después.
- «Confirmar y editar automáticamente» guarda esa revisión y continúa con subtítulos pendientes → plan → render MP4. En proyectos ya revisados, «Editar automáticamente» inicia el mismo flujo sin confirmaciones entre etapas. «Solo abrir editor» permite ajustar el proyecto manualmente antes de procesarlo. «Aprobar pendientes» acelera la clasificación: conserva decisiones existentes y aprueba como máximo una toma por escena, hasta 12; las alternativas siguen pendientes.
- Portafolios, proyectos, escenas, aprobaciones y bloopers guardados en Supabase.
- Editor con nueve estilos, 14 skills configurables por portafolio y un manifiesto que muestra qué se ejecuta. «IA en capas» toma como referencia visual el [reel de Lucho Rivero](https://www.instagram.com/reel/DfYILmwt3cL/): encabezado oscuro, subtítulos blancos con una palabra amarilla en una segunda línea, cortes secos y acentos de sonido. El editor muestra una miniatura del estilo antes del render.
- Carga directa de uno o varios videos sin rellenar nombre, libreto ni plan. El proyecto se crea automáticamente y abre la revisión de tomas. El libreto se puede añadir después para proponer el orden y señalar huecos o repeticiones; la preparación nunca cambia silenciosamente la secuencia elegida.
- Recomendaciones de planos de apoyo y rótulos basadas en el libreto. Los rótulos sugeridos se pueden aplicar a una toma y aparecen en el MP4; los planos que falten se deben grabar o subir.
- Render MP4 vertical con recorte de silencios, encuadre, color, transiciones, títulos y subtítulos. Se pueden importar transcripciones SRT o VTT con tiempos por toma; el render conserva esos tiempos tras recortes y eliminación de silencios.
- Progreso visible de la edición: los subtítulos aparecen al terminar cada toma y el render envía muestras breves de escenas ya procesadas. Estas muestras provienen del video renderizado; no son una animación de espera ni una transmisión de cada fotograma. El resultado completo se distingue de las muestras y solo se presenta como listo después de la verificación técnica.
- Efectos de sonido originales generados con FFmpeg para cortes de escena e internos; el volumen y estilo son configurables.
- Línea de tiempo manual con división y duplicación de tomas, orden, recorte, inclusión/exclusión, deshacer y rehacer. Cada segmento puede tener velocidad de 0,5× a 2×, volumen de voz y ajustes de brillo, contraste y saturación propios; estos valores llegan al MP4, incluidos los tiempos de subtítulos tras cambiar la velocidad.
- Catálogo consultable de las 244 herramientas de la guía de CapCut enviada por el propietario, organizado en 15 categorías y con estado **Disponible**, **Parcial** o **En desarrollo**. El catálogo no activa funciones que todavía no tienen motor.
- Pingüino guía en la esquina inferior derecha: ayuda contextual según la etapa del proyecto, preguntas frecuentes y botones que llevan a la acción. Funciona sin claves API y distingue las herramientas disponibles de las pendientes.
- Subtítulos automáticos en español: Whisper Base cuantizado en un Worker del navegador (WASM, sin API ni WebGPU obligatorio). Botón visible en el editor, progreso y cancelación, guardado local por toma y reintento de pendientes; las correcciones conservan tiempos. Primera descarga aproximada de 77 MB de pesos más runtime/tokenizador. Límite de audio: 2 minutos por toma; texto válido por segmento hasta 1.000 caracteres.
- Arrastrar y soltar en «Tus tomas» y «Orden del montaje», con ambas listas sincronizadas, indicador de inserción y alternativa con flechas/teclado. Al confirmar se conserva el orden de todas las tomas, incluidos bloopers y descartadas.
- El flujo automático usa el estilo y los ajustes del proyecto, conserva el orden confirmado y genera los subtítulos con tiempos reales. El libreto y los ajustes manuales son opcionales; el editor conserva controles individuales para corregir el resultado o trabajar por etapas.
- Verificación técnica de video y audio del archivo **después** de subirlo a Storage.

El render actual admite hasta 12 segmentos, 120 segundos de material fuente aprobado y 120 segundos de salida. La función de Vercel tiene un [límite de ejecución](https://vercel.com/docs/functions/limitations); un video largo necesita un trabajador de procesamiento independiente.

## Límites visibles en la interfaz

El libreto sirve de guía editorial, pero no transcribe el audio por sí solo. El reconocimiento automático y la importación SRT/VTT aportan transcripciones con tiempos; un texto plano no basta para exportar subtítulos sincronizados. La transcripción puede equivocarse en nombres o palabras y sigue siendo editable. El modo automático no deduce ni impone un orden narrativo nuevo: conserva la secuencia confirmada. Los recortes eliminan silencios medidos por audio, sin identificar errores de contenido. Las muestras del render son fragmentos, no una vista en tiempo real de cada modificación. La extracción automática de clips, B-roll, música y el puente cloud con Claude/Gemini están identificados como pendientes en sus skills. No se presentan como efectos ya renderizados.

El enlace del estudio abre primero el inicio de sesión. Solo la cuenta anfitriona configurada en `STUDIO_HOST_EMAIL` puede acceder a proyectos, videos, API y render. La contraseña se administra en Supabase Auth; no se guarda en el repositorio. Los proyectos que se vincularon a esa cuenta antes de activar el filtro conservan su propietario original.

## Desarrollo y despliegue

Requiere Node.js 22.13 o posterior. Configura las variables de `.env.example` en Vercel y en `.env.local` para desarrollo:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
STUDIO_HOST_EMAIL
STUDIO_RECOVERY_SECRET
```

Aplica las migraciones de `supabase/migrations` al proyecto correcto de Supabase y verifica que el bucket privado `kiko-videos` y sus políticas estén activos. El repositorio no incluye credenciales ni videos de usuarios.

La revisión de material usa registros `media_review` en `kiko_edit_jobs`, separados de los renders. Cada recibo incluye las decisiones, la secuencia y una huella del material. No requiere una migración adicional; los proyectos existentes deben confirmar su revisión antes de preparar otro render. Los MP4 anteriores continúan disponibles en la biblioteca.

```bash
npm ci
npm run lint
npm test
npm run build
npm run dev
```

La aplicación usa Next.js 16, React 19, Supabase Auth/Postgres/Storage y `ffmpeg-static`. El binario y la fuente Inter se incluyen en el trazado de `/api/editor/render` para Vercel. La fuente Inter se distribuye bajo la [licencia SIL OFL](assets/fonts/OFL.txt).

Los efectos sonoros se sintetizan dentro del render. Si se añade una biblioteca externa, hay que respetar sus condiciones de redistribución: [Mixkit](https://mixkit.co/license/modal/sfxFree/), [Pixabay](https://pixabay.com/service/license-summary/) y [Freesound](https://freesound.org/help/faq/) tienen reglas distintas.

Las responsabilidades de las 14 skills y su estado real están en [`skills/README.md`](skills/README.md).
Las etapas para que el editor sea profesional y verificable están en [`docs/PROFESSIONAL_EDITOR_PLAN.md`](docs/PROFESSIONAL_EDITOR_PLAN.md).

### Motor de subtítulos en el navegador

`npm run dev` y `npm run build` usan Webpack para compilar el Worker de reconocimiento como JavaScript. En esta versión de Next, Turbopack emitía el archivo TypeScript sin compilar como recurso estático. Transformers 4.3.2 incluye la corrección del optimizador ONNX/WASM necesaria para los pesos q8; no bajar esa versión sin verificar inferencia real en el navegador.
