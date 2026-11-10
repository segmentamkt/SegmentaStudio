---
name: segmenta-generador-imagenes
description: Pone imágenes de apoyo en los momentos clave de lo que se dice en Segmenta Studio: fotos gratis de Pexels (por defecto, automático) o imágenes creadas con Gemini o ChatGPT. Úsala al planificar recursos visuales que acompañan la voz.
---

# Imágenes de apoyo automáticas

**Por defecto, gratis: fotos de banco** (`lib/stock-image-providers.ts`, ruta `/api/resources/stock`):
- Pexels: búsqueda en español (`locale=es-ES`), horizontal o cuadrada según el encuadre. Clave gratis en `PEXELS_API_KEY` (sin tarjeta; ~200 búsquedas por hora). Licencia: uso comercial sin atribución obligatoria; el panel enlaza a Pexels como pide su API y el título guarda «Foto de…».
- Respaldo sin clave: Openverse, solo CC0/dominio público y solo de sus colecciones de banco (StockSnap, WP Photos, Nappy, Rawpixel); funciona mejor con palabras en inglés. Sin cuenta: 20 búsquedas por minuto, 200 al día.
- Pinterest y similares no: las imágenes son de terceros sin licencia y su extracción está prohibida.
- Cada búsqueda trae hasta 3 fotos: la primera se usa y las otras quedan para «Otra foto» sin gastar búsquedas.
- Activado por defecto en la edición automática; si no hay fotos, se usa la biblioteca.

**Opcional, de pago: IA** (`lib/ai-image-providers.ts`, claves en Vercel):
- Gemini: `gemini-nano-banana-2.1` por la API de Interactions (respaldo `generateContent`). Variable `GEMINI_API_KEY`.
- ChatGPT: `gpt-image-2.6-flare` por la Images API (`/v1/images/generations`). Variable `OPENAI_API_KEY`. OpenAI exige verificar la organización para sus modelos de imagen.
- Los modelos se cambian sin desplegar con `GEMINI_IMAGE_MODEL` y `OPENAI_IMAGE_MODEL`.

**Momentos** (`planAiVisualMoments`): palabras con tiempo real de voz, preferentemente sustantivos concretos (después de un artículo: «la lechona», «tu equipo»), cifras unidas a su sustantivo («5 talentos»). Adverbios, adjetivos y verbos pesan poco. Una imagen cada ~7 s como máximo, 2 por toma, 8 por video, 2 s de aire entre imágenes. Las imágenes manuales y las tomas revisadas no se tocan.

**Encargo** (`buildImagePrompt`): la oración completa que se dice, la idea clave, el tema del video (libreto o título) y un estilo fijo («3D como la biblioteca» o «Foto real»). Idéntico para los dos proveedores, para poder compararlos. Reglas: sin texto, cifras escritas, logotipos ni marcas de agua; sin personas reconocibles ni marcas reales.

**Entrega**: la imagen se recorta al encuadre (grande 920×520 o esquina) y se comprime a WebP (≤150 KB grande, ≤80 KB esquina) para caber en el límite del montaje; entra al render como cualquier imagen subida. En el panel de recursos: crear las imágenes del video, «Otra con Gemini / ChatGPT» por imagen y versiones anteriores para volver a ellas. Opción «Usar IA en la edición automática» (si falla, se usa la biblioteca).

Costo aproximado por imagen: Gemini 0,034 USD; ChatGPT ~0,05 USD (calidad media).
