import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedImageUrl, downloadCandidate, searchOpenverse, searchPexels, searchPixabay, stockQueries, type StockCandidate } from "../lib/stock-image-providers";
import { providerOfTitle } from "../lib/ai-visual-resources";

function fakeFetch(responses: Array<{ status: number; body?: unknown; bytes?: Buffer; length?: number }>) {
  const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
  const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers });
    const next = responses.shift()!;
    return {
      ok: next.status < 300, status: next.status,
      headers: { get: (name: string) => name === "content-length" && next.length ? String(next.length) : null },
      json: async () => next.body, arrayBuffer: async () => (next.bytes ?? Buffer.alloc(0)).buffer.slice(0) as ArrayBuffer,
    };
  };
  return { calls, fetchImpl };
}

test("Pexels: Spanish search with the free key, landscape photos for the big layout", async () => {
  const { calls, fetchImpl } = fakeFetch([{ status: 200, body: { photos: [
    { photographer: "Ana Ruiz", url: "https://www.pexels.com/photo/1/", src: { large2x: "https://images.pexels.com/photos/1/a.jpeg?w=1880", large: "https://images.pexels.com/photos/1/a.jpeg?w=940" } },
    { photographer: "Sin src", src: {} },
  ] } }]);
  const found = await searchPexels({ query: "lechona", layout: "wide", key: "pexels-key", fetchImpl });
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, "https://api.pexels.com/v1/search");
  assert.equal(url.searchParams.get("locale"), "es-ES");
  assert.equal(url.searchParams.get("orientation"), "landscape");
  assert.equal(calls[0].headers?.Authorization, "pexels-key", "Pexels takes the bare key, not «Bearer»");
  assert.deepEqual(found, [{ source: "pexels", imageUrl: "https://images.pexels.com/photos/1/a.jpeg?w=1880", author: "Ana Ruiz", pageUrl: "https://www.pexels.com/photo/1/" }]);
  const square = fakeFetch([{ status: 200, body: { photos: [] } }]);
  await searchPexels({ query: "x", layout: "corner", key: "k", fetchImpl: square.fetchImpl });
  assert.equal(new URL(square.calls[0].url).searchParams.get("orientation"), "square");
  await assert.rejects(searchPexels({ query: "x", layout: "wide", key: "bad", fetchImpl: fakeFetch([{ status: 401 }]).fetchImpl }), /clave de Pexels no es válida/);
  await assert.rejects(searchPexels({ query: "x", layout: "wide", key: "k", fetchImpl: fakeFetch([{ status: 429 }]).fetchImpl }), /límite por hora/);
});

test("Pixabay: Spanish photo search with the free key, cached 24 hours as its API asks", async () => {
  const { calls, fetchImpl } = fakeFetch([{ status: 200, body: { hits: [
    { largeImageURL: "https://pixabay.com/get/abc_1280.jpg", webformatURL: "https://pixabay.com/get/abc_640.jpg", user: "Lena", pageURL: "https://pixabay.com/photos/lechona-1/" },
    { webformatURL: "https://cdn.pixabay.com/photo/x_640.jpg", user: "Sin grande", pageURL: "" },
    { user: "Sin foto" },
  ] } }]);
  const found = await searchPixabay({ query: "lechona tolimense", layout: "wide", key: "pixabay-key", fetchImpl, now: 1_000 });
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, "https://pixabay.com/api/");
  assert.equal(url.searchParams.get("key"), "pixabay-key");
  assert.equal(url.searchParams.get("lang"), "es");
  assert.equal(url.searchParams.get("image_type"), "photo");
  assert.equal(url.searchParams.get("orientation"), "horizontal");
  assert.equal(url.searchParams.get("safesearch"), "true");
  assert.deepEqual(found.map((item) => [item.imageUrl, item.author]), [["https://pixabay.com/get/abc_1280.jpg", "Lena"], ["https://cdn.pixabay.com/photo/x_640.jpg", "Sin grande"]]);
  const again = await searchPixabay({ query: "Lechona tolimense", layout: "wide", key: "pixabay-key", fetchImpl: fakeFetch([]).fetchImpl, now: 1_000 + 60 * 60 * 1000 });
  assert.deepEqual(again, found, "the same search within 24 hours is served from the cache");
  await assert.rejects(searchPixabay({ query: "otra", layout: "corner", key: "bad", fetchImpl: fakeFetch([{ status: 400 }]).fetchImpl }), /clave de Pixabay no es válida/);
  await assert.rejects(searchPixabay({ query: "otra mas", layout: "corner", key: "k", fetchImpl: fakeFetch([{ status: 429 }]).fetchImpl }), /límite por minuto/);
  const pixabay = (imageUrl: string): StockCandidate => ({ source: "pixabay", imageUrl, author: "", pageUrl: "" });
  assert.ok(allowedImageUrl(pixabay("https://cdn.pixabay.com/photo/2026/a.jpg")) && allowedImageUrl(pixabay("https://pixabay.com/get/a.jpg")));
  assert.ok(!allowedImageUrl(pixabay("https://other.example/a.jpg")), "Pixabay photos only from Pixabay's servers");
});

test("Openverse: no key, only public-domain photos usable commercially", async () => {
  const { calls, fetchImpl } = fakeFetch([{ status: 200, body: { results: [
    { url: "https://cdn.stocksnap.io/a.jpg", license: "cc0", creator: "Stock", foreign_landing_url: "https://stocksnap.io/a" },
    { url: "https://example.org/b.jpg", license: "by-nc", creator: "Otro" },
    { url: "https://upload.wikimedia.org/c.jpg", license: "pdm", creator: "" },
  ] } }]);
  const found = await searchOpenverse({ query: "team meeting", layout: "wide", fetchImpl });
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get("license"), "cc0,pdm");
  assert.equal(url.searchParams.get("aspect_ratio"), "wide");
  assert.equal(url.searchParams.get("source"), "stocksnap,wordpress,nappy,rawpixel", "only stock collections, not Flickr or museums");
  assert.deepEqual(found.map((item) => item.imageUrl), ["https://cdn.stocksnap.io/a.jpg", "https://upload.wikimedia.org/c.jpg"], "a non-commercial licence never slips through");
});

test("photos are only downloaded over HTTPS from public hosts (Pexels only from its image server)", async () => {
  const pexels = (imageUrl: string): StockCandidate => ({ source: "pexels", imageUrl, author: "", pageUrl: "" });
  const open = (imageUrl: string): StockCandidate => ({ source: "openverse", imageUrl, author: "", pageUrl: "" });
  assert.ok(allowedImageUrl(pexels("https://images.pexels.com/photos/1/a.jpeg")));
  assert.ok(!allowedImageUrl(pexels("https://evil.example/a.jpeg")));
  assert.ok(allowedImageUrl(open("https://live.staticflickr.com/1/a.jpg")));
  for (const bad of ["http://cdn.stocksnap.io/a.jpg", "https://127.0.0.1/a.jpg", "https://localhost/a.jpg", "https://user:pw@cdn.stocksnap.io/a.jpg", "https://cdn.stocksnap.io:8443/a.jpg", "https://[::1]/a.jpg", "file:///etc/passwd"]) {
    assert.ok(!allowedImageUrl(open(bad)), bad);
  }
  await assert.rejects(downloadCandidate(open("https://127.0.0.1/a.jpg")), /no permitida/);
  await assert.rejects(downloadCandidate(open("https://cdn.stocksnap.io/a.jpg"), { fetchImpl: fakeFetch([{ status: 200, length: 99_000_000 }]).fetchImpl }), /demasiado grande/);
});

test("search words and source labels", () => {
  assert.deepEqual(stockQueries("5 talentos", "Parábola de los talentos"), ["talentos", "talentos Parábola de los talentos", "Parábola de los talentos"]);
  assert.deepEqual(stockQueries("lechona"), ["lechona"]);
  assert.equal(providerOfTitle("Pexels · lechona · Foto de Ana Ruiz"), "pexels");
  assert.equal(providerOfTitle("Openverse · equipo"), "openverse");
  assert.equal(providerOfTitle("Pixabay · lechona · Foto de Lena"), "pixabay");
});
