import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import type { CaptionCue } from "../lib/caption-cues";
import { buildImagePrompt, phraseAt, planAiVisualMoments, providerOfTitle } from "../lib/ai-visual-resources";
import { DEFAULT_IMAGE_MODELS, ImageProviderError, fitGeneratedImage, generateImageBytes, imageBytesFrom } from "../lib/ai-image-providers";
import { renderVisualResourceImage } from "../lib/visual-resource-image";

function cue(words: Array<[string, number, number]>): CaptionCue {
  return { startSeconds: words[0][1], endSeconds: words[words.length - 1][2], text: words.map(([text]) => text).join(" "), words: words.map(([text, startSeconds, endSeconds]) => ({ text, startSeconds, endSeconds })) };
}

const cues = [
  cue([["Hoy", 0.2, 0.5], ["les", 0.55, 0.7], ["cuento", 0.75, 1.1], ["cómo", 1.15, 1.4], ["preparamos", 1.45, 2.1], ["la", 2.15, 2.25], ["lechona", 2.3, 2.9]]),
  cue([["Son", 4.0, 4.2], ["25", 4.3, 4.7], ["años", 4.75, 5.1], ["de", 5.15, 5.25], ["tradición", 5.3, 6.0]]),
  cue([["en", 8.0, 8.1], ["Ibagué", 8.15, 8.8], ["y", 8.85, 8.9], ["todo", 8.95, 9.2], ["es", 9.25, 9.35], ["artesanal", 9.4, 10.2]]),
  cue([["Escríbenos", 13.0, 13.8], ["por", 13.85, 14.0], ["WhatsApp", 14.05, 14.8]]),
];
const clip = { segmentId: "toma-1", title: "Lechona", duration: 16, trimStartSeconds: 0, trimEndSeconds: 16, captionCues: cues, included: true, visualResources: [] };

test("key moments are anchored to real spoken words, spaced out and within the render limits", () => {
  const moments = planAiVisualMoments([clip]);
  assert.ok(moments.length >= 1 && moments.length <= 2, `16 s of video allow up to 2 images (max 2 per take): ${moments.length}`);
  for (const moment of moments) {
    const word = cues.flatMap((item) => item.words!).find((item) => item.text === moment.keyword);
    assert.ok(word, `${moment.keyword} is a word that was really said`);
    assert.ok(Math.abs(moment.startSeconds - (word.startSeconds - .05)) < 1e-6, "the image starts with the word");
    assert.ok(moment.endSeconds - moment.startSeconds >= .9 && moment.endSeconds <= clip.trimEndSeconds);
    assert.ok(moment.phrase.includes(moment.keyword), "the brief carries the whole spoken sentence");
  }
  assert.ok(!moments.some((moment) => ["les", "cómo", "la", "de", "y", "es", "por", "todo"].includes(moment.keyword)), "function words never become images");
  assert.equal(moments[0].keyword, "lechona", "a concrete noun after an article («la lechona») beats verbs and adverbs");
  const adverbs = planAiVisualMoments([{ ...clip, captionCues: [cue([["Trabajamos", 1, 1.6], ["fuertemente", 1.7, 2.6], ["por", 2.7, 2.8], ["la", 2.85, 2.95], ["familia", 3, 3.6]])] }]);
  assert.deepEqual(adverbs.map((moment) => moment.keyword), ["familia"]);
  const sorted = [...moments].sort((a, b) => a.startSeconds - b.startSeconds);
  for (let index = 1; index < sorted.length; index += 1) assert.ok(sorted[index].startSeconds >= sorted[index - 1].endSeconds + 2, "two seconds of breathing room");

  const manual = { ...clip, visualResources: [{ id: "mine", keyword: "Mía", startSeconds: 2, endSeconds: 4.6, layout: "corner" as const, image: { kind: "builtin" as const, assetId: "money" as const } }] };
  assert.ok(planAiVisualMoments([manual]).every((moment) => moment.startSeconds >= 6.6 || moment.endSeconds <= 0), "a manual image keeps its place and its margin");
  assert.deepEqual(planAiVisualMoments([{ ...clip, resourcesReviewed: true }]), [], "a reviewed take is left alone");
  assert.deepEqual(planAiVisualMoments([{ ...clip, captionCues: cues.map(({ words: _words, ...rest }) => { void _words; return rest; }) }]), [], "no images without real word timing");
  assert.equal(phraseAt(cues, 4.5), "Son 25 años de tradición");
});

test("one identical, rule-bound brief for Gemini and ChatGPT", () => {
  const prompt = buildImagePrompt({ keyword: "lechona", phrase: "cómo preparamos la lechona", context: "Lechona tradicional del Tolima", style: "3d", layout: "wide" });
  assert.match(prompt, /«cómo preparamos la lechona»/);
  assert.match(prompt, /«lechona»/);
  assert.match(prompt, /Tolima/);
  assert.match(prompt, /16:9/);
  assert.match(prompt, /sin texto, letras, cifras escritas, logotipos ni marcas de agua/);
  assert.match(buildImagePrompt({ keyword: "x", phrase: "y", style: "foto", layout: "corner" }), /fotografía real[\s\S]*1:1/);
  assert.equal(providerOfTitle("Gemini · lechona"), "gemini");
  assert.equal(providerOfTitle("ChatGPT · 25"), "openai");
  assert.equal(providerOfTitle("Mi foto"), null);
});

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    const next = responses.shift()!;
    return { ok: next.status < 300, status: next.status, json: async () => next.body, text: async () => JSON.stringify(next.body) };
  };
  return { calls, fetchImpl };
}
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("ChatGPT: the documented Images API request, key from Vercel, base64 answer", async () => {
  await assert.rejects(generateImageBytes({ provider: "openai", prompt: "p", layout: "wide", userId: "u", env: {} }),
    (error: unknown) => error instanceof ImageProviderError && error.status === 503 && error.missingKey === "OPENAI_API_KEY");
  const { calls, fetchImpl } = fakeFetch([{ status: 200, body: { data: [{ b64_json: pixel.toString("base64") }] } }]);
  const result = await generateImageBytes({ provider: "openai", prompt: "encargo", layout: "wide", userId: "user-1", env: { OPENAI_API_KEY: "sk-test" }, fetchImpl });
  assert.deepEqual(result.bytes, pixel);
  assert.equal(result.model, DEFAULT_IMAGE_MODELS.openai);
  assert.equal(calls[0].url, "https://api.openai.com/v1/images/generations");
  assert.equal(calls[0].headers.Authorization, "Bearer sk-test");
  assert.equal(calls[0].body.model, "gpt-image-2.6-flare");
  assert.equal(calls[0].body.size, "1536x1024");
  assert.equal(calls[0].body.output_format, "webp");
  assert.match(String(calls[0].body.safety_identifier), /^[0-9a-f]{32}$/, "the account is hashed, never sent");
  const denied = fakeFetch([{ status: 403, body: { error: { message: "Your organization must be verified" } } }]);
  await assert.rejects(generateImageBytes({ provider: "openai", prompt: "p", layout: "corner", userId: "u", env: { OPENAI_API_KEY: "k", OPENAI_IMAGE_MODEL: "gpt-image-2.6-sunburst" }, fetchImpl: denied.fetchImpl }),
    /verificar la organización/);
  assert.equal(denied.calls[0].body.model, "gpt-image-2.6-sunburst", "the model can be changed from Vercel");
  assert.equal(denied.calls[0].body.size, "1024x1024");
});

test("Gemini: Interactions API with Nano Banana 2.1, and generateContent when Interactions is missing", async () => {
  const direct = fakeFetch([{ status: 200, body: { output_image: { data: pixel.toString("base64") } } }]);
  const first = await generateImageBytes({ provider: "gemini", prompt: "encargo", layout: "wide", userId: "u", env: { GEMINI_API_KEY: "g-test" }, fetchImpl: direct.fetchImpl });
  assert.deepEqual(first.bytes, pixel);
  assert.equal(direct.calls[0].url, "https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(direct.calls[0].headers["x-goog-api-key"], "g-test");
  assert.equal(direct.calls[0].headers["Api-Revision"], "2026-05-20");
  assert.equal(direct.calls[0].body.model, "gemini-nano-banana-2.1");
  assert.deepEqual(direct.calls[0].body.response_format, { type: "image", mime_type: "image/jpeg", aspect_ratio: "16:9", image_size: "1K" });

  assert.deepEqual(imageBytesFrom("gemini", { steps: [{ type: "model_output", content: [{ type: "text", text: "listo" }, { type: "image", data: pixel.toString("base64") }] }] }), pixel);
  const fallback = fakeFetch([{ status: 404, body: { error: { message: "not found" } } }, { status: 200, body: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: pixel.toString("base64") } }] } }] } }]);
  const second = await generateImageBytes({ provider: "gemini", prompt: "encargo", layout: "corner", userId: "u", env: { GEMINI_API_KEY: "g" }, fetchImpl: fallback.fetchImpl });
  assert.deepEqual(second.bytes, pixel);
  assert.equal(fallback.calls[1].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent");
  assert.deepEqual(fallback.calls[1].body.generationConfig, { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1" } });
  const blocked = fakeFetch([{ status: 200, body: { steps: [] } }]);
  await assert.rejects(generateImageBytes({ provider: "gemini", prompt: "p", layout: "wide", userId: "u", env: { GEMINI_API_KEY: "g" }, fetchImpl: blocked.fetchImpl }), /sin imagen/);
});

test("a generated image is cropped to the layout, fits the montage budget and passes the real renderer", async () => {
  const noise = await sharp(Buffer.from(Array.from({ length: 1536 * 1024 * 3 }, (_, index) => (index * 2654435761) % 251)), { raw: { width: 1536, height: 1024, channels: 3 } }).png().toBuffer();
  const wide = await fitGeneratedImage(noise, "wide");
  assert.equal(wide.width, 920);
  assert.ok(wide.bytes <= 150_000, `${wide.bytes} bytes`);
  const corner = await fitGeneratedImage(noise, "corner");
  assert.ok(corner.bytes <= 80_000);
  const rendered = await renderVisualResourceImage({ id: "ai:t:1", keyword: "lechona", startSeconds: 0, endSeconds: 2, layout: "wide", image: { kind: "upload", dataUrl: wide.dataUrl, title: "Gemini · lechona" } });
  const metadata = await sharp(rendered).metadata();
  assert.equal(metadata.width, 920);
  assert.equal(metadata.height, 520);
});
