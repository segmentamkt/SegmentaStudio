/**
 * Fotos de banco gratis con licencia comercial, solo en el servidor.
 *
 * - Pexels: búsqueda en español (`locale=es-ES`), clave gratis en PEXELS_API_KEY. Desde 2026-11 Pexels
 *   no entrega claves nuevas: sirve para quien ya tenga una.
 * - Pixabay: búsqueda en español (`lang=es`), clave gratis en PIXABAY_API_KEY. Licencia de contenido de
 *   Pixabay: uso comercial sin atribución obligatoria; la API pide descargar las fotos (no enlazarlas) y
 *   guardar los resultados 24 horas.
 *   Ambas: la API pide mostrar de dónde vienen las fotos (el panel enlaza a la fuente).
 * - Openverse (respaldo, sin clave): solo CC0 y dominio público (`license=cc0,pdm`), uso libre.
 * Las imágenes solo se descargan de los servidores de esas fuentes y por HTTPS.
 */
import type { VisualResource } from "./visual-resources";

export type StockSource = "pexels" | "pixabay" | "openverse";
export type StockCandidate = { source: StockSource; imageUrl: string; author: string; pageUrl: string };

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean; status: number; headers?: { get(name: string): string | null }; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer>;
}>;
type Json = Record<string, unknown>;
const record = (value: unknown): Json => (value && typeof value === "object" ? value as Json : {});
const text = (value: unknown) => (typeof value === "string" ? value : "");

export class StockSearchError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;
/** Hosts that serve the images Pexels and Openverse point to (never arbitrary URLs). */
const PEXELS_HOSTS = new Set(["images.pexels.com"]);
const PIXABAY_HOSTS = new Set(["cdn.pixabay.com", "pixabay.com"]);
const DAY_MS = 24 * 60 * 60 * 1000;
/** Pixabay asks to cache every search for 24 hours (per server instance; best effort on serverless). */
const pixabayCache = new Map<string, { at: number; candidates: StockCandidate[] }>();
const OPENVERSE_STOCK_SOURCES = "stocksnap,wordpress,nappy,rawpixel";

export async function searchPexels(input: { query: string; layout: VisualResource["layout"]; key: string; fetchImpl?: FetchLike; signal?: AbortSignal; perPage?: number }): Promise<StockCandidate[]> {
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as FetchLike);
  const params = new URLSearchParams({ query: input.query, locale: "es-ES", per_page: String(input.perPage ?? 6), orientation: input.layout === "wide" ? "landscape" : "square", size: "medium" });
  const response = await fetchImpl(`https://api.pexels.com/v1/search?${params}`, { headers: { Authorization: input.key }, signal: input.signal });
  if (response.status === 401 || response.status === 403) throw new StockSearchError("La clave de Pexels no es válida. Revísala en Vercel (PEXELS_API_KEY).", 502);
  if (response.status === 429) throw new StockSearchError("Pexels alcanzó su límite por hora. Vuelve a intentarlo más tarde.", 429);
  if (!response.ok) throw new StockSearchError(`Pexels no respondió bien (${response.status}).`, 502);
  const photos = (record(await response.json()).photos as unknown[] | undefined) ?? [];
  return photos.flatMap((raw) => {
    const photo = record(raw);
    const src = record(photo.src);
    const imageUrl = text(input.layout === "wide" ? src.large2x || src.large : src.large || src.medium);
    return imageUrl ? [{ source: "pexels" as const, imageUrl, author: text(photo.photographer).slice(0, 60), pageUrl: text(photo.url) }] : [];
  });
}

export async function searchPixabay(input: { query: string; layout: VisualResource["layout"]; key: string; fetchImpl?: FetchLike; signal?: AbortSignal; perPage?: number; now?: number }): Promise<StockCandidate[]> {
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as FetchLike);
  const perPage = Math.max(3, Math.min(200, input.perPage ?? 6));
  const now = input.now ?? Date.now();
  const cacheKey = `${input.query.toLowerCase()}|${input.layout}|${perPage}`;
  const cached = pixabayCache.get(cacheKey);
  if (cached && now - cached.at < DAY_MS) return cached.candidates;
  const params = new URLSearchParams({ key: input.key, q: input.query.slice(0, 100), lang: "es", image_type: "photo", orientation: input.layout === "wide" ? "horizontal" : "all", safesearch: "true", per_page: String(perPage) });
  const response = await fetchImpl(`https://pixabay.com/api/?${params}`, { signal: input.signal });
  if (response.status === 400 || response.status === 401 || response.status === 403) throw new StockSearchError("La clave de Pixabay no es válida. Revísala en Vercel (PIXABAY_API_KEY).", 502);
  if (response.status === 429) throw new StockSearchError("Pixabay alcanzó su límite por minuto. Vuelve a intentarlo en un momento.", 429);
  if (!response.ok) throw new StockSearchError(`Pixabay no respondió bien (${response.status}).`, 502);
  const hits = (record(await response.json()).hits as unknown[] | undefined) ?? [];
  const candidates = hits.flatMap((raw) => {
    const hit = record(raw);
    const imageUrl = text(hit.largeImageURL || hit.webformatURL);
    return imageUrl ? [{ source: "pixabay" as const, imageUrl, author: text(hit.user).slice(0, 60), pageUrl: text(hit.pageURL) }] : [];
  });
  pixabayCache.set(cacheKey, { at: now, candidates });
  if (pixabayCache.size > 500) pixabayCache.delete(pixabayCache.keys().next().value!);
  return candidates;
}

export async function searchOpenverse(input: { query: string; layout: VisualResource["layout"]; fetchImpl?: FetchLike; signal?: AbortSignal; pageSize?: number }): Promise<StockCandidate[]> {
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as FetchLike);
  // Only Openverse's stock-photo collections: Flickr and museums bring people, brands and toys.
  const params = new URLSearchParams({ q: input.query, license: "cc0,pdm", source: OPENVERSE_STOCK_SOURCES, page_size: String(input.pageSize ?? 8), mature: "false", aspect_ratio: input.layout === "wide" ? "wide" : "square" });
  const response = await fetchImpl(`https://api.openverse.org/v1/images/?${params}`, { headers: { Accept: "application/json" }, signal: input.signal });
  if (response.status === 429) throw new StockSearchError("Openverse alcanzó su límite (20 por minuto, 200 al día sin cuenta).", 429);
  if (!response.ok) throw new StockSearchError(`Openverse no respondió bien (${response.status}).`, 502);
  const results = (record(await response.json()).results as unknown[] | undefined) ?? [];
  return results.flatMap((raw) => {
    const item = record(raw);
    const license = text(item.license).toLowerCase();
    // Defense in depth: keep only licenses that need no attribution and allow commercial use.
    if (license !== "cc0" && license !== "pdm") return [];
    const imageUrl = text(item.url);
    return imageUrl ? [{ source: "openverse" as const, imageUrl, author: text(item.creator).slice(0, 60), pageUrl: text(item.foreign_landing_url) }] : [];
  });
}

/** HTTPS only, public hostnames only; Pexels images only from Pexels' image host. */
export function allowedImageUrl(candidate: StockCandidate) {
  let url: URL;
  try { url = new URL(candidate.imageUrl); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || /^[\d.]+$/.test(host) || host.includes(":")) return false;
  if (candidate.source === "pexels") return PEXELS_HOSTS.has(host);
  if (candidate.source === "pixabay") return PIXABAY_HOSTS.has(host);
  return true;
}

export async function downloadCandidate(candidate: StockCandidate, input: { fetchImpl?: FetchLike; signal?: AbortSignal } = {}): Promise<Buffer> {
  if (!allowedImageUrl(candidate)) throw new StockSearchError("La foto viene de una dirección no permitida.", 502);
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as FetchLike);
  const response = await fetchImpl(candidate.imageUrl, { headers: { Accept: "image/avif,image/webp,image/jpeg,image/png,*/*;q=0.5" }, signal: input.signal });
  if (!response.ok) throw new StockSearchError(`No se pudo descargar la foto (${response.status}).`, 502);
  const declared = Number(response.headers?.get("content-length") ?? 0);
  if (declared > MAX_DOWNLOAD_BYTES) throw new StockSearchError("La foto es demasiado grande.", 502);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_DOWNLOAD_BYTES) throw new StockSearchError("La foto es demasiado grande o está vacía.", 502);
  return bytes;
}

/** Palabras de búsqueda: la idea clave sin cifras sueltas; si no hay resultados se prueba con el tema del video. */
export function stockQueries(keyword: string, context?: string) {
  const main = keyword.replace(/\d+/g, " ").replace(/\s+/g, " ").trim() || keyword.trim();
  const topic = (context ?? "").split(/[.\n]/)[0].replace(/[«»"“”]/g, "").split(/\s+/).slice(0, 4).join(" ").trim();
  return [...new Set([main, topic && `${main} ${topic}`, topic].filter((query): query is string => Boolean(query && query.length >= 3)))].slice(0, 3);
}
