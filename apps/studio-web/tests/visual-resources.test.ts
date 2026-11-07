import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILTIN_VISUAL_RESOURCE_IDS, MAX_VISUAL_IMAGE_BYTES, MAX_VISUAL_RESOURCES_TOTAL,
  builtinAssetPath, createVisualResourceBudget, normalizeVisualResources, recommendVisualResources,
  resourceImageSrc, validateVisualResourceBudget, visualImageByteLength,
  type VisualResource, type VisualResourceClip,
} from "../lib/visual-resources";

function clip(id: string, text: string, patch: Partial<VisualResourceClip> = {}): VisualResourceClip {
  return { segmentId: id, duration: 20, trimStartSeconds: 0, trimEndSeconds: 20,
    captionCues: [{ startSeconds: 1, endSeconds: 3, text }], ...patch };
}
function resource(id = "r-1", patch: Partial<VisualResource> = {}): VisualResource {
  return { id, keyword: "ideas", startSeconds: 1, endSeconds: 3, layout: "corner", image: { kind: "builtin", assetId: "ideas" }, ...patch };
}
const bounds = { durationSeconds: 20, trimStartSeconds: 0, trimEndSeconds: 20 };
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1cAAAAASUVORK5CYII=";

test("detects normalized Spanish whole words and never guesses a time from an untimed script", () => {
  const result = recommendVisualResources([
    clip("money", "Cuida tus DÓLARES."),
    clip("ideas", "Esas IDEAS necesitan acción."),
    clip("substring", "El empresario construyó un contratiempo imaginario."),
    clip("untimed", "", { captionCues: [] }),
  ]);
  assert.deepEqual(result.money[0].image, { kind: "builtin", assetId: "money" });
  assert.equal(result.money[0].keyword, "dólares");
  assert.equal(result.ideas[0].keyword, "ideas");
  assert.equal(result.substring.length, 0);
  assert.equal(result.untimed.length, 0);
});

test("timestamps stay absolute within late source trims and respect playback speed", () => {
  const result = recommendVisualResources([clip("late", "", {
    duration: 360, trimStartSeconds: 300, trimEndSeconds: 320, playbackSpeed: 2,
    captionCues: [{ startSeconds: 299, endSeconds: 301, text: "Tiempo" }, { startSeconds: 310, endSeconds: 312, text: "Miedo" },
      { startSeconds: 325, endSeconds: 327, text: "Ideas" }],
  })]);
  assert.equal(result.late[0].startSeconds, 300);
  assert.equal(result.late[0].endSeconds, 305.2);
  assert.equal(result.late.length, 2);
  assert.ok(result.late.every((item) => item.startSeconds >= 300 && item.endSeconds <= 320));
  normalizeVisualResources(result.late, { durationSeconds: 360, trimStartSeconds: 300, trimEndSeconds: 320 });
});

test("limits density, avoids repeated concepts, and leaves breathing room across clips", () => {
  const result = recommendVisualResources([
    clip("first", "", { duration: 6, trimEndSeconds: 6, captionCues: [
      { startSeconds: 0, endSeconds: 1, text: "dinero" },
      { startSeconds: 1, endSeconds: 2, text: "ideas" },
      { startSeconds: 5, endSeconds: 6, text: "trabajo" },
    ] }),
    clip("second", "", { captionCues: [{ startSeconds: 0, endSeconds: 1, text: "miedo" },
      { startSeconds: 4, endSeconds: 6, text: "dinero" }, { startSeconds: 8, endSeconds: 10, text: "ideas" }] }),
  ]);
  assert.equal(result.first.length, 2);
  assert.equal(result.second.length, 1);
  assert.equal(result.second[0].keyword, "ideas");
  const all = Object.values(result).flat();
  assert.ok(all.length <= MAX_VISUAL_RESOURCES_TOTAL);
  assert.equal(new Set(all.map((item) => item.image.kind === "builtin" && item.image.assetId)).size, all.length);
});

test("keeps manual choices and dismissed empty lists, reserving global budget and concepts", () => {
  const existing = resource("manual", { image: { kind: "builtin", assetId: "money" } });
  const clips = [clip("dismissed", "ideas", { resourcesReviewed: true }),
    clip("manual", "miedo", { visualResources: [existing], resourcesReviewed: true }), clip("repeat", "dinero"), clip("new", "ideas")];
  const original = JSON.stringify(clips);
  const result = recommendVisualResources(clips);
  assert.deepEqual(result.dismissed, []);
  assert.deepEqual(result.manual, []);
  assert.deepEqual(result.repeat, []);
  assert.equal(result.new.length, 1);
  assert.equal(JSON.stringify(clips), original);
  const full = Array.from({ length: 8 }, (_, i) => clip(`existing-${i}`, "", { visualResources: [resource(`existing-${i}`)] }));
  assert.deepEqual(recommendVisualResources([...full, clip("none", "dinero")]).none, []);
});

test("manual images in a later clip reserve nearby display time before recommendations", () => {
  const result = recommendVisualResources([
    clip("early", "", { duration: 5, trimEndSeconds: 5, captionCues: [{ startSeconds: 4, endSeconds: 5, text: "dinero" }] }),
    clip("later", "", { visualResources: [resource("next", { startSeconds: 0, endSeconds: 3 })] }),
  ]);
  assert.deepEqual(result.early, []);
});

test("excludes disabled clips and invalid source metadata without inventing images", () => {
  const result = recommendVisualResources([clip("excluded", "ideas", { included: false }),
    clip("invalid", "dinero", { duration: NaN }), clip("speed", "trabajo", { playbackSpeed: 0 }),
    clip("short", "miedo", { duration: .2, trimEndSeconds: .2, captionCues: [{ startSeconds: 0, endSeconds: .2, text: "miedo" }] })]);
  assert.ok(Object.values(result).every((items) => !items.length));
});

test("old contracts remain compatible and only approved builtin asset paths are available", () => {
  assert.deepEqual(normalizeVisualResources(undefined, bounds), []);
  assert.deepEqual(normalizeVisualResources(null, bounds), []);
  for (const id of BUILTIN_VISUAL_RESOURCE_IDS) assert.equal(builtinAssetPath(id), `/visual-resources/${id}.png`);
  const normalized = normalizeVisualResources([resource()], bounds);
  assert.equal(resourceImageSrc(normalized[0].image), "/visual-resources/ideas.png");
  assert.throws(() => normalizeVisualResources([resource("r", { image: { kind: "builtin", assetId: "../../etc/passwd" } as never })], bounds));
});

test("rejects resources outside trimmed media, invalid numbers, long overlays, and duplicate IDs", () => {
  const trimmed = { durationSeconds: 20, trimStartSeconds: 5, trimEndSeconds: 15 };
  for (const patch of [{ startSeconds: 4, endSeconds: 7 }, { startSeconds: 5, endSeconds: 16 },
    { startSeconds: NaN, endSeconds: 8 }, { startSeconds: 7, endSeconds: 7.01 }]) {
    assert.throws(() => normalizeVisualResources([resource("r", patch)], trimmed));
  }
  assert.throws(() => normalizeVisualResources([resource("r", { startSeconds: 1, endSeconds: 15 })], bounds));
  assert.throws(() => normalizeVisualResources([resource(), resource()], bounds));
  assert.throws(() => normalizeVisualResources([resource("a"), resource("b"), resource("c")], bounds));
  assert.throws(() => normalizeVisualResources([resource("x", { layout: "url(http://host)" as never })], bounds));
});

test("allows embedded PNG, JPEG and WebP signatures, but rejects SVG, external URLs and disguised formats", () => {
  const jpg = `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 0]).toString("base64")}`;
  const webp = `data:image/webp;base64,${Buffer.from("RIFFxxxxWEBPVP8 ").toString("base64")}`;
  for (const dataUrl of [png, jpg, webp]) {
    const image = { kind: "upload" as const, dataUrl, title: "Imagen propia" };
    assert.equal(resourceImageSrc(normalizeVisualResources([resource("r", { image })], bounds)[0].image), dataUrl);
    assert.ok(visualImageByteLength(dataUrl) > 0);
  }
  for (const dataUrl of ["https://example.com/photo.png", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", png.replace("png", "jpeg"),
    "data:image/png;base64,PHNjcmlwdD4=", png + "\n", "data:image/png;base64,a==="]) {
    assert.throws(() => normalizeVisualResources([resource("r", { image: { kind: "upload", dataUrl, title: "Imagen" } })], bounds));
  }
});

test("enforces decoded image bytes and montage budgets without partial budget mutation on error", () => {
  const bytes = Buffer.alloc(MAX_VISUAL_IMAGE_BYTES);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
  assert.equal(visualImageByteLength(dataUrl), MAX_VISUAL_IMAGE_BYTES);
  const large = (id: string) => resource(id, { image: { kind: "upload", dataUrl, title: "Imagen" } });
  validateVisualResourceBudget(Array.from({ length: 7 }, (_, i) => large(`r${i}`)));
  assert.throws(() => validateVisualResourceBudget(Array.from({ length: 8 }, (_, i) => large(`r${i}`))), /1,5 MB/);
  assert.throws(() => validateVisualResourceBudget(Array.from({ length: 9 }, (_, i) => resource(`r${i}`))), /8 recursos/);
  assert.throws(() => validateVisualResourceBudget([resource(), resource()]), /repetidos/);
  assert.throws(() => visualImageByteLength(`data:image/png;base64,${Buffer.concat([bytes, Buffer.from([0])]).toString("base64")}`), /200 KB/);
  const budget = createVisualResourceBudget();
  normalizeVisualResources([large("a"), large("b")], bounds, budget);
  assert.equal(budget.count, 2);
  const previous = { ...budget };
  assert.throws(() => normalizeVisualResources([resource("c"), resource("d", { endSeconds: Infinity })], bounds, budget));
  assert.deepEqual(budget, previous);
});


test("allows exact decimal duration boundaries despite floating point subtraction", () => {
  const short = resource("decimal-short", { startSeconds: 1.1, endSeconds: 1.2 });
  assert.deepEqual(normalizeVisualResources([short], bounds), [short]);
  const long = resource("decimal-long", { startSeconds: 4.2, endSeconds: 16.2 });
  assert.deepEqual(normalizeVisualResources([long], bounds), [long]);
  assert.throws(() => normalizeVisualResources([resource("too-short", { startSeconds: 1.1, endSeconds: 1.19 })], bounds));
  assert.throws(() => normalizeVisualResources([resource("too-long", { startSeconds: 1.1, endSeconds: 13.11 })], bounds));
});
