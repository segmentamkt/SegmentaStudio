# Segmenta Studio

Editor de video vertical para [studio.segmenta.online](https://studio.segmenta.online), publicado desde [SegmentaStudio](https://github.com/segmentamkt/SegmentaStudio) en Vercel.

## Lo que funciona

- Grabación desde cámara, teleprompter e importación de varios videos con revisión toma por toma.
- Portafolios, proyectos, escenas, aprobaciones y bloopers guardados en Supabase.
- Editor con ocho estilos, 14 skills configurables por portafolio y un manifiesto que muestra qué se ejecuta.
- Libreto completo guardado por proyecto y obligatorio antes de preparar una exportación. El estudio compara sus partes con el texto hablado de cada toma, propone el orden cuando la coincidencia es suficiente y señala huecos o repeticiones.
- Recomendaciones de planos de apoyo y rótulos basadas en el libreto. Los rótulos sugeridos se pueden aplicar a una toma y aparecen en el MP4; los planos que falten se deben grabar o subir.
- Render MP4 vertical con recorte de silencios, encuadre, color, transiciones, títulos y subtítulos. Se pueden importar transcripciones SRT o VTT con tiempos por toma; el render conserva esos tiempos tras recortes y eliminación de silencios.
- Efectos de sonido originales generados con FFmpeg para cortes de escena e internos; el volumen y estilo son configurables.
- Línea de tiempo manual con división y duplicación de tomas, orden, recorte, inclusión/exclusión, deshacer y rehacer. Cada segmento puede tener velocidad de 0,5× a 2×, volumen de voz y ajustes de brillo, contraste y saturación propios; estos valores llegan al MP4, incluidos los tiempos de subtítulos tras cambiar la velocidad.
- Catálogo consultable de las 244 herramientas de la guía de CapCut enviada por el propietario, organizado en 15 categorías y con estado **Disponible**, **Parcial** o **En desarrollo**. El catálogo no activa funciones que todavía no tienen motor.
- Verificación técnica de video y audio del archivo **después** de subirlo a Storage.

El render actual admite hasta 12 segmentos, 120 segundos de material fuente aprobado y 120 segundos de salida. La función de Vercel tiene un [límite de ejecución](https://vercel.com/docs/functions/limitations); un video largo necesita un trabajador de procesamiento independiente.

## Límites visibles en la interfaz

El libreto sirve de guía editorial, pero no transcribe el audio por sí solo. Para relacionar tomas y libreto hay que escribir el texto hablado de cada toma o importar una transcripción. SRT/VTT aporta tiempos; el texto plano se reparte de manera aproximada y no tiene sincronía palabra a palabra. Los recortes eliminan silencios medidos por audio, sin identificar errores de contenido. La extracción automática de clips, B-roll, música y el puente cloud con Claude/Gemini están identificados como pendientes en sus skills. No se presentan como efectos ya renderizados.

El acceso actual crea una sesión anónima de Supabase por navegador. Los proyectos quedan aislados por sesión; entrar desde otro dispositivo no recupera automáticamente los mismos datos hasta que se implemente un acceso o vínculo de dispositivos.

## Desarrollo y despliegue

Requiere Node.js 22.13 o posterior. Configura las variables de `.env.example` en Vercel y en `.env.local` para desarrollo:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Aplica las migraciones de `supabase/migrations` al proyecto correcto de Supabase y verifica que el bucket privado `kiko-videos` y sus políticas estén activos. El repositorio no incluye credenciales ni videos de usuarios.

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
