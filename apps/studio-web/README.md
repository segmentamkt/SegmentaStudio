# Segmenta Studio

Editor de video vertical para [studio.segmenta.online](https://studio.segmenta.online), publicado desde [SegmentaStudio](https://github.com/segmentamkt/SegmentaStudio) en Vercel.

## Lo que funciona

- Grabación desde cámara, teleprompter e importación de varios videos con revisión toma por toma.
- Portafolios, proyectos, escenas, aprobaciones y bloopers guardados en Supabase.
- Editor con ocho estilos, 14 skills configurables por portafolio y un manifiesto que muestra qué se ejecuta.
- Render MP4 vertical con recorte de silencios, encuadre, color, transiciones, títulos y tarjetas de subtítulos basadas en el libreto.
- Efectos de sonido originales generados con FFmpeg para cortes de escena e internos; el volumen y estilo son configurables.
- Verificación técnica de video y audio del archivo **después** de subirlo a Storage.

El render actual admite hasta 12 tomas y 120 segundos de material fuente. La función de Vercel tiene un [límite de ejecución](https://vercel.com/docs/functions/limitations); un video largo necesita un trabajador de procesamiento independiente.

## Límites visibles en la interfaz

Los subtítulos usan el libreto y distribuyen sus tarjetas a lo largo de cada toma. Todavía no transcriben la voz ni tienen sincronía palabra a palabra. Los recortes eliminan silencios medidos por audio, sin identificar errores de contenido. La extracción automática de clips, B-roll, música y el puente cloud con Claude/Gemini están identificados como pendientes en sus skills. No se presentan como efectos ya renderizados.

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
