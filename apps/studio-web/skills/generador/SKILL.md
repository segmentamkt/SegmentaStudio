---
name: segmenta-generador-imagenes
description: Crea imágenes de apoyo con Gemini o ChatGPT para los momentos clave de lo que se dice en Segmenta Studio. Úsala al planificar recursos visuales que acompañan la voz.
---

# Imágenes creadas con IA

**Proveedores** (`lib/ai-image-providers.ts`, solo servidor, claves en Vercel):
- Gemini: `gemini-nano-banana-2.1` por la API de Interactions (respaldo `generateContent`). Variable `GEMINI_API_KEY`.
- ChatGPT: `gpt-image-2.6-flare` por la Images API (`/v1/images/generations`). Variable `OPENAI_API_KEY`. OpenAI exige verificar la organización para sus modelos de imagen.
- Los modelos se cambian sin desplegar con `GEMINI_IMAGE_MODEL` y `OPENAI_IMAGE_MODEL`.

**Momentos** (`planAiVisualMoments`): palabras con tiempo real de voz, preferentemente sustantivos concretos (después de un artículo: «la lechona», «tu equipo»), cifras unidas a su sustantivo («5 talentos»). Adverbios, adjetivos y verbos pesan poco. Una imagen cada ~7 s como máximo, 2 por toma, 8 por video, 2 s de aire entre imágenes. Las imágenes manuales y las tomas revisadas no se tocan.

**Encargo** (`buildImagePrompt`): la oración completa que se dice, la idea clave, el tema del video (libreto o título) y un estilo fijo («3D como la biblioteca» o «Foto real»). Idéntico para los dos proveedores, para poder compararlos. Reglas: sin texto, cifras escritas, logotipos ni marcas de agua; sin personas reconocibles ni marcas reales.

**Entrega**: la imagen se recorta al encuadre (grande 920×520 o esquina) y se comprime a WebP (≤150 KB grande, ≤80 KB esquina) para caber en el límite del montaje; entra al render como cualquier imagen subida. En el panel de recursos: crear las imágenes del video, «Otra con Gemini / ChatGPT» por imagen y versiones anteriores para volver a ellas. Opción «Usar IA en la edición automática» (si falla, se usa la biblioteca).

Costo aproximado por imagen: Gemini 0,034 USD; ChatGPT ~0,05 USD (calidad media).
