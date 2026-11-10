import { getRequestUser, unauthorized } from "../../../../lib/request-user";
import { fitGeneratedImage } from "../../../../lib/ai-image-providers";
import { SOURCE_LABELS } from "../../../../lib/ai-visual-resources";
import { StockSearchError, downloadCandidate, searchOpenverse, searchPexels, searchPixabay, stockQueries, type StockCandidate, type StockSource } from "../../../../lib/stock-image-providers";
import type { VisualResource } from "../../../../lib/visual-resources";

export const maxDuration = 60;

/**
 * Fotos de banco para un momento del video: Pexels o Pixabay (claves gratis) y, si no hay clave o
 * resultados, Openverse (dominio público, sin clave). Devuelve hasta 3 fotos listas para el render: la primera
 * se usa y las demás quedan como alternativas sin gastar más búsquedas.
 */
export async function POST(request: Request) {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: "La solicitud no es válida." }, { status: 400 }); }
  const keyword = typeof payload.keyword === "string" ? payload.keyword.trim() : "";
  const context = typeof payload.context === "string" ? payload.context.trim().slice(0, 300) : "";
  const layout = (payload.layout ?? "wide") as VisualResource["layout"];
  const skip = Math.max(0, Math.min(30, Math.floor(Number(payload.skip) || 0)));
  if (!keyword || keyword.length > 60 || !["wide", "corner"].includes(layout)) return Response.json({ error: "Falta la idea clave de la foto." }, { status: 400 });
  const signal = AbortSignal.timeout(50_000);
  const keys: Partial<Record<StockSource, string>> = { pexels: process.env.PEXELS_API_KEY?.trim(), pixabay: process.env.PIXABAY_API_KEY?.trim() };
  const problems: string[] = [];
  let found: { source: StockSource; query: string; candidates: StockCandidate[] } | null = null;
  try {
    const sources = (["pexels", "pixabay"] as const).filter((source) => keys[source]);
    for (const source of [...sources, "openverse" as const]) {
      for (const query of stockQueries(keyword, context)) {
        try {
          const candidates = source === "pexels" ? await searchPexels({ query, layout, key: keys.pexels!, signal, perPage: Math.min(80, skip + 6) })
            : source === "pixabay" ? await searchPixabay({ query, layout, key: keys.pixabay!, signal, perPage: Math.min(200, skip + 6) })
            : await searchOpenverse({ query, layout, signal, pageSize: Math.min(20, skip + 8) });
          if (candidates.length > skip) { found = { source, query, candidates: candidates.slice(skip) }; break; }
        } catch (error) {
          problems.push(error instanceof Error ? error.message : String(error));
          break;
        }
      }
      if (found) break;
    }
    if (!found) return Response.json({ error: `No encontré fotos para «${keyword}».${problems.length ? ` ${problems[0]}` : ""}` }, { status: 404 });
    const settled = await Promise.allSettled(found.candidates.slice(0, 5).map(async (candidate) => {
      const fitted = await fitGeneratedImage(await downloadCandidate(candidate, { signal }), layout);
      const credit = candidate.author ? ` · Foto de ${candidate.author}` : "";
      return { kind: "upload" as const, dataUrl: fitted.dataUrl, title: `${SOURCE_LABELS[candidate.source]} · ${keyword}${credit}`.slice(0, 160) };
    }));
    const images = settled.flatMap((item) => item.status === "fulfilled" ? [item.value] : []).slice(0, 3);
    if (!images.length) return Response.json({ error: "Las fotos encontradas no se pudieron descargar. Vuelve a intentarlo." }, { status: 502 });
    return Response.json({ images, source: found.source, query: found.query, usedFallback: sources.length > 0 && found.source === "openverse" });
  } catch (error) {
    if (error instanceof StockSearchError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return Response.json({ error: "La búsqueda de fotos tardó demasiado." }, { status: 504 });
    return Response.json({ error: "No se pudo buscar la foto." }, { status: 500 });
  }
}
