/**
 * Generación de imágenes en el servidor con las APIs oficiales (solo servidor: usa las claves de Vercel).
 *
 * - ChatGPT (OpenAI Images API): POST /v1/images/generations, modelo `gpt-image-2.6-flare` por defecto
 *   (rápido para el día a día; `gpt-image-2.6-sunburst` si se prefiere más precisión). Devuelve base64.
 * - Gemini (Nano Banana): API de Interactions, modelo `gemini-nano-banana-2.1` por defecto, con
 *   respaldo en `generateContent` si la cuenta aún no tiene Interactions.
 * Los modelos se pueden cambiar sin desplegar código con OPENAI_IMAGE_MODEL y GEMINI_IMAGE_MODEL.
 * La imagen se recorta al encuadre del render y se comprime a WebP bajo el límite de 200 KB.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import { AI_PROVIDERS, type AiImageProvider } from "./ai-visual-resources";
import { MAX_VISUAL_IMAGE_BYTES, type VisualResource } from "./visual-resources";

export const DEFAULT_IMAGE_MODELS: Record<AiImageProvider, string> = { openai: "gpt-image-2.6-flare", gemini: "gemini-nano-banana-2.1" };
const GEMINI_API_REVISION = "2026-05-20";
const OUTPUT_SIZES: Record<VisualResource["layout"], { width: number; height: number }> = { corner: { width: 512, height: 512 }, wide: { width: 920, height: 520 } };

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;
type Environment = Record<string, string | undefined>;

export class ImageProviderError extends Error {
  constructor(message: string, readonly status: number, readonly missingKey?: string) { super(message); }
}

type Json = Record<string, unknown>;
const asRecord = (value: unknown): Json => (value && typeof value === "object" ? value as Json : {});

async function failure(provider: AiImageProvider, response: Awaited<ReturnType<FetchLike>>): Promise<never> {
  let detail = "";
  try {
    const body = asRecord(await response.json());
    const error = asRecord(body.error);
    detail = String(error.message ?? body.message ?? "").slice(0, 300);
  } catch { /* The provider did not return JSON. */ }
  const label = AI_PROVIDERS[provider].label;
  const hint = response.status === 401 || response.status === 403
    ? `La clave de ${label} no tiene permiso${provider === "openai" ? " (OpenAI pide verificar la organización para sus modelos de imagen)" : ""}.`
    : response.status === 429 ? `${label} limitó las solicitudes o falta saldo en la cuenta.`
    : response.status === 400 ? `${label} rechazó el encargo de imagen.` : `${label} no respondió bien (${response.status}).`;
  throw new ImageProviderError(detail ? `${hint} ${detail}` : hint, response.status === 429 ? 429 : 502);
}

/** Extrae los bytes de las respuestas documentadas de cada API. */
export function imageBytesFrom(provider: AiImageProvider, body: unknown): Buffer | null {
  const data = asRecord(body);
  if (provider === "openai") {
    const first = asRecord((data.data as unknown[] | undefined)?.[0]);
    return typeof first.b64_json === "string" ? Buffer.from(first.b64_json, "base64") : null;
  }
  const direct = asRecord(data.output_image).data;
  if (typeof direct === "string") return Buffer.from(direct, "base64");
  for (const step of (data.steps as unknown[] | undefined) ?? []) {
    for (const part of (asRecord(step).content as unknown[] | undefined) ?? []) {
      const item = asRecord(part);
      if (item.type === "image" && typeof item.data === "string") return Buffer.from(item.data, "base64");
    }
  }
  for (const candidate of (data.candidates as unknown[] | undefined) ?? []) {
    for (const part of (asRecord(asRecord(candidate).content).parts as unknown[] | undefined) ?? []) {
      const inline = asRecord(asRecord(part).inlineData ?? asRecord(part).inline_data);
      if (typeof inline.data === "string") return Buffer.from(inline.data, "base64");
    }
  }
  return null;
}

export async function generateImageBytes(input: {
  provider: AiImageProvider; prompt: string; layout: VisualResource["layout"]; userId: string;
  env?: Environment; fetchImpl?: FetchLike; signal?: AbortSignal;
}): Promise<{ bytes: Buffer; model: string }> {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as FetchLike);
  const key = env[AI_PROVIDERS[input.provider].envKey]?.trim();
  if (!key) throw new ImageProviderError(`Falta configurar la clave de ${AI_PROVIDERS[input.provider].label} en Vercel (${AI_PROVIDERS[input.provider].envKey}).`, 503, AI_PROVIDERS[input.provider].envKey);
  const model = (input.provider === "openai" ? env.OPENAI_IMAGE_MODEL : env.GEMINI_IMAGE_MODEL)?.trim() || DEFAULT_IMAGE_MODELS[input.provider];
  if (input.provider === "openai") {
    const response = await fetchImpl("https://api.openai.com/v1/images/generations", {
      method: "POST", signal: input.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model, prompt: input.prompt, n: 1,
        size: input.layout === "wide" ? "1536x1024" : "1024x1024",
        quality: "medium", output_format: "webp", output_compression: 85,
        // A stable, non-identifying hash lets OpenAI attribute abuse without receiving the account.
        safety_identifier: createHash("sha256").update(`segmenta-studio:${input.userId}`).digest("hex").slice(0, 32),
      }),
    });
    if (!response.ok) await failure("openai", response);
    const bytes = imageBytesFrom("openai", await response.json());
    if (!bytes?.length) throw new ImageProviderError("ChatGPT respondió sin imagen.", 502);
    return { bytes, model };
  }
  const headers = { "x-goog-api-key": key, "Content-Type": "application/json" };
  const aspectRatio = input.layout === "wide" ? "16:9" : "1:1";
  const interactions = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST", signal: input.signal, headers: { ...headers, "Api-Revision": GEMINI_API_REVISION },
    body: JSON.stringify({ model, input: input.prompt, response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: aspectRatio, image_size: "1K" } }),
  });
  let response = interactions;
  if (interactions.status === 404) {
    // Accounts or regions without the Interactions API still serve generateContent.
    response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", signal: input.signal, headers,
      body: JSON.stringify({ contents: [{ parts: [{ text: input.prompt }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio } } }),
    });
  }
  if (!response.ok) await failure("gemini", response);
  const bytes = imageBytesFrom("gemini", await response.json());
  if (!bytes?.length) throw new ImageProviderError("Gemini respondió sin imagen (puede haberla bloqueado su filtro de seguridad). Prueba con ChatGPT o cambia la frase.", 502);
  return { bytes, model };
}

/** Recorta al encuadre del render y comprime a WebP bajo el límite de imagen del montaje. */
export async function fitGeneratedImage(bytes: Buffer, layout: VisualResource["layout"]) {
  const { width, height } = OUTPUT_SIZES[layout];
  const base = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error", animated: false }).rotate()
    .resize(width, height, { fit: "cover", position: "attention" }).flatten({ background: "#0E0E10" });
  for (const quality of [82, 74, 66, 58, 50, 42]) {
    const output = await base.clone().webp({ quality, effort: 4 }).toBuffer();
    // Eight wide images must also fit the 1.5 MB budget of the whole montage.
    if (output.length <= Math.min(MAX_VISUAL_IMAGE_BYTES - 4096, layout === "wide" ? 150_000 : 80_000)) return { dataUrl: `data:image/webp;base64,${output.toString("base64")}`, bytes: output.length, width, height };
  }
  throw new ImageProviderError("La imagen generada no cabe en el límite de 200 KB.", 502);
}
