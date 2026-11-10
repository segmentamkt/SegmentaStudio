import { getRequestUser, unauthorized } from "../../../../lib/request-user";
import { AI_PROVIDERS, AI_STYLES, buildImagePrompt, type AiImageProvider, type AiImageStyle } from "../../../../lib/ai-visual-resources";
import { ImageProviderError, fitGeneratedImage, generateImageBytes } from "../../../../lib/ai-image-providers";
import type { VisualResource } from "../../../../lib/visual-resources";

export const maxDuration = 60;

/** Qué fuentes de imagen están disponibles (sin revelar nada de las claves). Openverse no necesita clave. */
export async function GET() {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  return Response.json({ providers: {
    ...Object.fromEntries(Object.entries(AI_PROVIDERS).map(([id, provider]) => [id, Boolean(process.env[provider.envKey]?.trim())])),
    pexels: Boolean(process.env.PEXELS_API_KEY?.trim()), pixabay: Boolean(process.env.PIXABAY_API_KEY?.trim()), openverse: true,
  } });
}

/** Una imagen de apoyo para un momento del video, creada con Gemini o ChatGPT y lista para el render. */
export async function POST(request: Request) {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: "La solicitud no es válida." }, { status: 400 }); }
  const provider = payload.provider as AiImageProvider;
  const style = (payload.style ?? "3d") as AiImageStyle;
  const layout = (payload.layout ?? "wide") as VisualResource["layout"];
  const keyword = typeof payload.keyword === "string" ? payload.keyword.trim() : "";
  const phrase = typeof payload.phrase === "string" ? payload.phrase.trim() : "";
  const context = typeof payload.context === "string" ? payload.context.trim() : "";
  if (!Object.hasOwn(AI_PROVIDERS, provider) || !Object.hasOwn(AI_STYLES, style) || !["wide", "corner"].includes(layout)) {
    return Response.json({ error: "Elige Gemini o ChatGPT, un estilo y un encuadre válidos." }, { status: 400 });
  }
  if (!keyword || keyword.length > 60 || !phrase || phrase.length > 300 || context.length > 300) {
    return Response.json({ error: "Falta la frase o la idea clave de la imagen (o son demasiado largas)." }, { status: 400 });
  }
  const prompt = buildImagePrompt({ keyword, phrase, context, style, layout });
  try {
    const generated = await generateImageBytes({ provider, prompt, layout, userId: user.userId, signal: AbortSignal.timeout(55_000) });
    const fitted = await fitGeneratedImage(generated.bytes, layout);
    return Response.json({
      image: { kind: "upload", dataUrl: fitted.dataUrl, title: `${AI_PROVIDERS[provider].label} · ${keyword}`.slice(0, 160) },
      provider, model: generated.model, prompt, bytes: fitted.bytes,
    });
  } catch (error) {
    if (error instanceof ImageProviderError) return Response.json({ error: error.message, missingKey: error.missingKey }, { status: error.status });
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return Response.json({ error: `${AI_PROVIDERS[provider].label} tardó demasiado. Vuelve a intentarlo.` }, { status: 504 });
    }
    return Response.json({ error: "No se pudo crear la imagen. Vuelve a intentarlo." }, { status: 500 });
  }
}
