import assert from "node:assert/strict";
import test from "node:test";
import { getEditorStyle, type EditorStyleId } from "../lib/editor-presets";
import { normalizeRenderContract } from "../lib/render-contract-security";
import { defaultSkillProfiles } from "../lib/studio-skills";

const ownerId = "owner-test";
const sessionId = "session-test";

function fixture(count = 2, clipDurationMs = 10_000, styleId: EditorStyleId = "aula-premium") {
  const style = getEditorStyle(styleId);
  const session = { id: sessionId, owner_id: ownerId, title: "Una historia útil", script: "Libreto aprobado" };
  const orderedScenes = Array.from({ length: count }, (_, index) => ({
    id: `scene-${index}`,
    owner_id: ownerId,
    session_id: sessionId,
    position: index,
    title: `Escena ${index + 1}`,
    script: `Texto real de la escena ${index + 1}`,
    selected_take_id: `take-${index}`,
  }));
  const takes = orderedScenes.map((scene) => ({
    id: scene.selected_take_id,
    owner_id: ownerId,
    session_id: sessionId,
    scene_id: scene.id,
    status: "approved",
    duration_ms: clipDurationMs,
    object_key: `${ownerId}/${sessionId}/${scene.id}/${scene.selected_take_id}.mp4`,
  }));
  const raw = {
    schema: "kiko.edit-contract.v1",
    objective: "Edita con ritmo claro y subtítulos legibles.",
    session: { id: sessionId, title: session.title, script: session.script },
    ordered_clip_ids: takes.map((take) => take.id),
    clips: orderedScenes.map((scene, index) => ({
      id: takes[index].id,
      scene_id: scene.id,
      name: scene.title,
      object_key: takes[index].object_key,
      duration_seconds: clipDurationMs / 1_000,
      transcript: scene.script,
    })),
    style: styleId,
    style_snapshot: { ...style, subtitle: { ...style.subtitle }, execution: { ...style.execution } },
    captions: { enabled: true, language: "es", max_words_per_card: style.subtitle.maxWords, emphasis: true },
    dead_air: { remove: true, threshold_ms: style.execution.silenceThresholdMs },
    effects: { transitions: true, sound_effects: true, labels: true, images_or_broll: false, music: false },
    skill_profiles: defaultSkillProfiles(),
  };
  // Database result order must not dictate the render order.
  return { session, scenes: orderedScenes.reverse(), takes, raw };
}

test("rebuilds a valid contract from DB rows and applies bounded skill overrides", () => {
  const input = fixture();
  input.raw.clips[0].transcript = "Text injected by the browser";
  input.raw.style_snapshot.execution.titleColor = "#ff00ff";
  const subtitles = input.raw.skill_profiles.find((profile) => profile.id === "subtitulos")!;
  subtitles.settings = { ...subtitles.settings, size: 90, position: "top", maxWords: 3, uppercase: true };
  subtitles.overrides = ["size", "position", "maxWords", "uppercase"];
  const transitions = input.raw.skill_profiles.find((profile) => profile.id === "transiciones")!;
  transitions.settings = { ...transitions.settings, type: "dissolve", duration: 0.3 };
  transitions.overrides = ["type", "duration"];
  const color = input.raw.skill_profiles.find((profile) => profile.id === "filtros")!;
  color.settings = { ...color.settings, saturation: 1.2 };
  color.overrides = ["saturation"];

  const output = normalizeRenderContract(input.raw, input.session, input.scenes, input.takes);
  assert.deepEqual(output.ordered_clip_ids, ["take-0", "take-1"]);
  assert.equal(output.clips[0].transcript, "Text injected by the browser");
  assert.equal(output.clips[0].object_key, input.takes[0].object_key);
  assert.equal(output.style_snapshot.execution.titleColor, getEditorStyle("aula-premium").execution.titleColor);
  assert.equal(output.style_snapshot.subtitle.size, 90);
  assert.equal(output.style_snapshot.subtitle.position, "top");
  assert.equal(output.style_snapshot.subtitle.uppercase, true);
  assert.equal(output.captions.max_words_per_card, 3);
  assert.equal(output.style_snapshot.transition, "dissolve");
  assert.equal(output.style_snapshot.transitionDuration, 0.3);
  assert.equal(output.style_snapshot.execution.saturation, 1.2);
  assert.ok(output.skill_manifest.configuredRenderSkills.includes("subtitulos"));
});

test("new quality gate refuses captions inferred only from untimed text", () => {
  const input = fixture();
  Object.assign(input.raw, { quality_gates: { timed_captions: true } });
  assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /tiempos reales/);
  input.raw.clips.forEach((clip) => Object.assign(clip, { caption_cues: [{ startSeconds: .2, endSeconds: 1.2, text: clip.transcript }] }));
  const normalized = normalizeRenderContract(input.raw, input.session, input.scenes, input.takes);
  assert.equal(normalized.quality_gates.timed_captions, true);
});

test("keeps a supported noise reduction level and rejects unknown filters", () => {
  const input = fixture();
  Object.assign(input.raw.style_snapshot.execution, { noiseReduction: "medium" });
  const normalized = normalizeRenderContract(input.raw, input.session, input.scenes, input.takes);
  assert.equal(normalized.style_snapshot.execution.noiseReduction, "medium");
  Object.assign(input.raw.style_snapshot.execution, { noiseReduction: "aggressive" });
  assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /reducción de ruido/);
});

test("rejects a browser-supplied object key that differs from the approved take", () => {
  const input = fixture();
  input.raw.clips[0].object_key = `${ownerId}/${sessionId}/scene-0/other.mp4`;
  assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /ruta de video no autorizada/);
});

test("rejects a take whose approved status was revoked", () => {
  const input = fixture();
  input.takes[0].status = "rejected";
  assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /ya no está aprobada/);
});

test("allows exactly 12 clips and 120 edited seconds, then rejects either excess", () => {
  const atLimit = fixture(12, 10_000);
  assert.equal(normalizeRenderContract(atLimit.raw, atLimit.session, atLimit.scenes, atLimit.takes).clips.length, 12);

  const tooMany = fixture(13, 1_000);
  assert.throws(() => normalizeRenderContract(tooMany.raw, tooMany.session, tooMany.scenes, tooMany.takes), /hasta 12 tomas/);

  const tooLong = fixture(2, 60_001);
  assert.throws(() => normalizeRenderContract(tooLong.raw, tooLong.session, tooLong.scenes, tooLong.takes), /120 segundos/);
});

test("long sources are valid when only their selected intervals fit the output limit", () => {
  const input = fixture(11, 15_000);
  input.raw.clips.forEach((clip) => Object.assign(clip, { trim_start_seconds: 5, trim_end_seconds: 15 }));
  const output = normalizeRenderContract(input.raw, input.session, input.scenes, input.takes);
  assert.equal(output.clips.length, 11);
  assert.equal(output.clips.reduce((sum, clip) => sum + clip.duration_seconds, 0), 165);
  assert.equal(output.clips.reduce((sum, clip) => sum + (clip.trim_end_seconds - clip.trim_start_seconds) / clip.playback_speed, 0), 110);
});

test("late source timestamps and speed survive normalization without weakening the 120s output limit", () => {
  const input = fixture(1, 900_000);
  Object.assign(input.raw.clips[0], { trim_start_seconds: 500, trim_end_seconds: 740, playback_speed: 2,
    caption_cues: [{ startSeconds: 501, endSeconds: 502, text: "Voz real al final" }] });
  const output = normalizeRenderContract(input.raw, input.session, input.scenes, input.takes);
  assert.equal(output.clips[0].duration_seconds, 900);
  assert.equal(output.clips[0].trim_start_seconds, 500);
  assert.equal(output.clips[0].caption_cues[0].startSeconds, 501);
  Object.assign(input.raw.clips[0], { trim_end_seconds: 741 });
  assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /120 segundos/);
});

test("rejects a plan after the selected take of a scene changes", () => {
  const input = fixture();
  const scene = input.scenes.find((item) => item.id === "scene-0")!;
  scene.selected_take_id = "replacement-take";
  input.takes.push({
    id: "replacement-take",
    owner_id: ownerId,
    session_id: sessionId,
    scene_id: scene.id,
    status: "approved",
    duration_ms: 10_000,
    object_key: `${ownerId}/${sessionId}/${scene.id}/replacement-take.mp4`,
  });
  assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /El plan cambió/);
});

test("accepts an official cut-only style with zero transition duration", () => {
  const input = fixture(2, 10_000, "reflexion-intima");
  const output = normalizeRenderContract(input.raw, input.session, input.scenes, input.takes);
  assert.equal(output.style_snapshot.transition, "cut");
  assert.equal(output.style_snapshot.transitionDuration, 0);
});

test("renders an approved subset in the manual order with bounded trims and captions", () => {
  const input = fixture(3);
  const [first, second, third] = input.raw.clips;
  input.raw.clips = [third, first];
  input.raw.ordered_clip_ids = [third.id, first.id];
  input.raw.clips[0].transcript = "Cierre aprobado por el editor";
  Object.assign(input.raw.clips[0], { trim_start_seconds: 1.2, trim_end_seconds: 7.5, label: "Pide tu cotización" });
  const output = normalizeRenderContract(input.raw, input.session, input.scenes, input.takes);
  assert.deepEqual(output.ordered_clip_ids, ["take-2", "take-0"]);
  assert.equal(output.clips[0].trim_start_seconds, 1.2);
  assert.equal(output.clips[0].trim_end_seconds, 7.5);
  assert.equal(output.clips[0].label, "Pide tu cotización");
  assert.equal(output.clips[0].transcript, "Cierre aprobado por el editor");
  assert.equal(output.clips.length, 2);
  assert.notEqual(second.id, output.clips[1].id);
});

test("keeps per-clip speed, volume and color controls within safe render limits", () => {
  const input = fixture();
  Object.assign(input.raw.clips[0], { playback_speed: 1.5, audio_volume: 0, brightness: .08, contrast: 1.2, saturation: .75 });
  const output = normalizeRenderContract(input.raw, input.session, input.scenes, input.takes);
  assert.equal(output.clips[0].playback_speed, 1.5);
  assert.equal(output.clips[0].audio_volume, 0);
  assert.equal(output.clips[0].brightness, .08);
  assert.equal(output.clips[0].contrast, 1.2);
  assert.equal(output.clips[0].saturation, .75);
  Object.assign(input.raw.clips[0], { playback_speed: 3 });
  assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /velocidad de una toma/);
});

test("rejects duplicate, foreign and invalid manual edits", () => {
  const input = fixture(2);
  input.raw.ordered_clip_ids = ["take-0", "take-0"];
  assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /plan cambió/);
  input.raw.ordered_clip_ids = ["take-0", "take-foreign"];
  assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /no autorizada/);
  input.raw.ordered_clip_ids = ["take-0", "take-1"];
  Object.assign(input.raw.clips[0], { trim_start_seconds: 8, trim_end_seconds: 8.1 });
  assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /0,2 segundos/);
});

test("accepts two distinct segments of the same approved take", () => {
  const input = fixture(1, 70_000);
  const first = input.raw.clips[0];
  const firstPart = { ...first };
  const secondPart = { ...first };
  Object.assign(firstPart, { trim_start_seconds: 0, trim_end_seconds: 30 });
  Object.assign(secondPart, { trim_start_seconds: 30, trim_end_seconds: 70 });
  input.raw.ordered_clip_ids = [first.id, first.id];
  input.raw.clips = [firstPart, secondPart];
  const output = normalizeRenderContract(input.raw, input.session, input.scenes, input.takes);
  assert.deepEqual(output.ordered_clip_ids, ["take-0", "take-0"]);
  assert.deepEqual(output.clips.map((clip) => [clip.trim_start_seconds, clip.trim_end_seconds]), [[0, 30], [30, 70]]);
});

test("does not silently export a partially captioned video", () => {
  const input = fixture(2);
  input.raw.clips[1].transcript = "";
  assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /Falta el texto hablado/);
});

test("keeps timed subtitles and rejects timestamps beyond the approved take", () => {
  const input = fixture();
  Object.assign(input.raw.clips[0], { caption_cues: [{ startSeconds: 1, endSeconds: 2.5, text: "Una idea clara" }] });
  const output = normalizeRenderContract(input.raw, input.session, input.scenes, input.takes);
  assert.deepEqual(output.clips[0].caption_cues, [{ startSeconds: 1, endSeconds: 2.5, text: "Una idea clara" }]);
  Object.assign(input.raw.clips[0], { caption_cues: [{ startSeconds: 9, endSeconds: 11, text: "Fuera de toma" }] });
  assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /final de un subtítulo/);
});

test("allows an optional script and invalidates an older plan when it changes", () => {
  const input = fixture();
  input.session.script = "Nuevo libreto";
  assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /libreto cambió/);
  input.raw.session.script = "Nuevo libreto";
  assert.equal(normalizeRenderContract(input.raw, input.session, input.scenes, input.takes).session.script, "Nuevo libreto");
  input.session.script = "";
  assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /libreto cambió/);
  input.raw.session.script = "";
  input.raw.captions.enabled = false;
  input.raw.clips.forEach((clip) => { clip.transcript = ""; });
  const withoutScript = normalizeRenderContract(input.raw, input.session, input.scenes, input.takes);
  assert.equal(withoutScript.session.script, "");
  assert.equal(withoutScript.captions.enabled, false);
});

test("only accepts the supported silence sensitivity levels", () => {
  const input = fixture(2);
  Object.assign(input.raw.dead_air, { noise_db: -25 });
  assert.equal(normalizeRenderContract(input.raw, input.session, input.scenes, input.takes).dead_air.noise_db, -25);
  Object.assign(input.raw.dead_air, { noise_db: -21 });
  assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /sensibilidad de silencio/);
});

function builtinResource(id = "resource-0") {
  return { id, keyword: "dinero", startSeconds: 1, endSeconds: 3, layout: "corner", image: { kind: "builtin", assetId: "money" } };
}

const pixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1y0AAAAASUVORK5CYII=";

test("older plans without image resources remain renderable and do not claim images", () => {
  const input = fixture();
  const output = normalizeRenderContract(input.raw, input.session, input.scenes, input.takes);
  assert.deepEqual(output.clips.map((clip) => clip.visual_resources), [[], []]);
  assert.equal(output.effects.images_or_broll, false);
  assert.equal(output.quality_gates.images, false);
  assert.ok(!output.skill_manifest.configuredRenderSkills.includes("generador"));
});

test("keeps approved builtin images, strips untrusted paths and counts the configured resources", () => {
  const input = fixture();
  input.raw.effects.images_or_broll = true;
  const resource = { ...builtinResource(), command: "untrusted", path: "/etc/passwd", image: { kind: "builtin", assetId: "money", path: "/etc/passwd", url: "https://example.com/tracker.png" } };
  Object.assign(input.raw.clips[0], { visual_resources: [resource] });
  const output = normalizeRenderContract(input.raw, input.session, input.scenes, input.takes);
  assert.deepEqual(output.clips[0].visual_resources, [builtinResource()]);
  assert.equal(output.effects.images_or_broll, true);
  assert.equal(output.quality_gates.images, true);
  assert.ok(output.skill_manifest.configuredRenderSkills.includes("generador"));
  assert.match(output.skill_manifest.decisions.find((item) => item.skillId === "generador")!.summary, /1 imagen de apoyo programada/);
});

test("preserves bounded uploaded PNG data without trusting any supplied URL", () => {
  const input = fixture();
  input.raw.effects.images_or_broll = true;
  const resource = { ...builtinResource(), layout: "wide", image: { kind: "upload", dataUrl: pixelPng, title: "Mi foto", url: "file:///etc/passwd" } };
  Object.assign(input.raw.clips[0], { visual_resources: [resource] });
  const output = normalizeRenderContract(input.raw, input.session, input.scenes, input.takes);
  assert.deepEqual(output.clips[0].visual_resources[0].image, { kind: "upload", dataUrl: pixelPng, title: "Mi foto" });
  assert.equal(output.clips[0].visual_resources[0].layout, "wide");
});

test("rejects remote, SVG and unknown images even when the image effect is disabled", () => {
  for (const image of [
    { kind: "builtin", assetId: "../../etc/passwd" },
    { kind: "remote", url: "https://example.com/image.png" },
    { kind: "upload", dataUrl: "data:image/svg+xml;base64,PHN2Zy8+", title: "Vector" },
    { kind: "upload", dataUrl: "https://example.com/image.png", title: "Remota" },
    { kind: "upload", dataUrl: "data:image/png;base64,SGVsbG8=", title: "Falsa" },
  ]) {
    const input = fixture();
    Object.assign(input.raw.clips[0], { visual_resources: [{ ...builtinResource(), image }] });
    assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /imagen|biblioteca/);
  }
});

test("image source timestamps are bounded by the actual approved duration and manual trim", () => {
  for (const [startSeconds, endSeconds] of [[0, 2], [8, 10], [3, 3], [3, Number.NaN], [3, 12]]) {
    const input = fixture();
    Object.assign(input.raw.clips[0], { trim_start_seconds: 2, trim_end_seconds: 8, visual_resources: [{ ...builtinResource(), startSeconds, endSeconds }] });
    assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /dentro del recorte/);
  }
  const input = fixture(1, 900_000);
  Object.assign(input.raw.clips[0], { trim_start_seconds: 500, trim_end_seconds: 510, visual_resources: [{ ...builtinResource(), startSeconds: 502, endSeconds: 505 }] });
  const output = normalizeRenderContract(input.raw, input.session, input.scenes, input.takes);
  assert.equal(output.clips[0].visual_resources[0].startSeconds, 502);
  assert.equal(output.clips[0].visual_resources[0].endSeconds, 505);
});

test("resources remain saved but disabled skills or editor toggles do not claim an image render", () => {
  for (const disabledIn of ["skill", "editor"]) {
    const input = fixture();
    Object.assign(input.raw.clips[0], { visual_resources: [builtinResource()] });
    input.raw.effects.images_or_broll = disabledIn === "skill";
    if (disabledIn === "skill") input.raw.skill_profiles.find((profile) => profile.id === "generador")!.enabled = false;
    const output = normalizeRenderContract(input.raw, input.session, input.scenes, input.takes);
    assert.equal(output.clips[0].visual_resources.length, 1);
    assert.equal(output.effects.images_or_broll, false);
    assert.equal(output.quality_gates.images, false);
    assert.ok(!output.skill_manifest.configuredRenderSkills.includes("generador"));
    assert.match(output.skill_manifest.decisions.find((item) => item.skillId === "generador")!.summary, /desactivados/);
  }
});

test("a requested image effect with no selected resources is not a configured render skill", () => {
  const input = fixture();
  input.raw.effects.images_or_broll = true;
  const output = normalizeRenderContract(input.raw, input.session, input.scenes, input.takes);
  assert.equal(output.effects.images_or_broll, false);
  assert.equal(output.quality_gates.images, false);
  assert.match(output.skill_manifest.decisions.find((item) => item.skillId === "generador")!.summary, /No hay imágenes/);
});

test("rejects more than two images per clip or eight images across a montage", () => {
  const perClip = fixture();
  Object.assign(perClip.raw.clips[0], { visual_resources: [builtinResource("a"), builtinResource("b"), builtinResource("c")] });
  assert.throws(() => normalizeRenderContract(perClip.raw, perClip.session, perClip.scenes, perClip.takes), /hasta 2 recursos/);
  const montage = fixture(5);
  montage.raw.clips.forEach((clip, index) => Object.assign(clip, { visual_resources: [builtinResource(`a-${index}`), builtinResource(`b-${index}`)] }));
  assert.throws(() => normalizeRenderContract(montage.raw, montage.session, montage.scenes, montage.takes), /hasta 8 recursos/);
});

test("rejects aggregate uploaded image bytes and oversized individual images", () => {
  const pngBytes = Buffer.alloc(200 * 1024);
  pngBytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const upload = { kind: "upload", title: "Foto", dataUrl: `data:image/png;base64,${pngBytes.toString("base64")}` };
  const input = fixture(4);
  input.raw.clips.forEach((clip, index) => Object.assign(clip, { visual_resources: [0, 1].map((n) => ({ ...builtinResource(`${index}-${n}`), image: upload })) }));
  assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /superan 1,5 MB/);
  const oversized = fixture();
  Object.assign(oversized.raw.clips[0], { visual_resources: [{ ...builtinResource(), image: { ...upload, dataUrl: `data:image/png;base64,${Buffer.concat([pngBytes, Buffer.alloc(1)]).toString("base64")}` } }] });
  assert.throws(() => normalizeRenderContract(oversized.raw, oversized.session, oversized.scenes, oversized.takes), /hasta 200 KB/);
});

test("music without a chosen song is refused independently of the image effect", () => {
  const input = fixture();
  input.raw.effects.music = true;
  input.raw.effects.images_or_broll = true;
  assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /Elige una canción/);
});


test("preserves explicit visual review decisions without marking empty legacy resources reviewed", () => {
  const input = fixture();
  let output = normalizeRenderContract(input.raw, input.session, input.scenes, input.takes);
  assert.deepEqual(output.clips.map((clip) => clip.visual_resources_reviewed), [false, false]);
  Object.assign(input.raw.clips[0], { visual_resources: [], visual_resources_reviewed: true });
  Object.assign(input.raw.clips[1], { visual_resources: [builtinResource()], visual_resources_reviewed: false });
  output = normalizeRenderContract(input.raw, input.session, input.scenes, input.takes);
  assert.equal(output.clips[0].visual_resources_reviewed, true);
  assert.equal(output.clips[1].visual_resources_reviewed, false);
  Object.assign(input.raw.clips[0], { visual_resources_reviewed: "yes" });
  assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /revisión de recursos visuales/);
});

test("the Segmenta kinetic style keeps one-word captions, chest position and valid word timings", () => {
  const input = fixture(1, 10_000, "segmenta-cinetico");
  Object.assign(input.raw.clips[0], { caption_cues: [
    { startSeconds: 1, endSeconds: 2, text: "Hola equipo", words: [{ text: "Hola", startSeconds: 1, endSeconds: 1.4 }, { text: "equipo", startSeconds: 1.5, endSeconds: 1.9 }] },
    { startSeconds: 3, endSeconds: 4, text: "fuera", words: [{ text: "fuera", startSeconds: 8, endSeconds: 9 }] },
  ] });
  const output = normalizeRenderContract(input.raw, input.session, input.scenes, input.takes);
  assert.equal(output.style_snapshot.subtitle.mode, "palabra");
  assert.equal(output.style_snapshot.subtitle.position, "chest");
  assert.deepEqual(output.clips[0].caption_cues[0].words?.map((word) => word.text), ["Hola", "equipo"]);
  assert.equal(output.clips[0].caption_cues[1].words, undefined, "timings outside the cue are dropped, not trusted");
});

test("the subtitle skill can switch any style to kinetic mode and rejects unknown modes", () => {
  const input = fixture();
  const subtitles = input.raw.skill_profiles.find((profile) => profile.id === "subtitulos")!;
  subtitles.settings = { ...subtitles.settings, mode: "palabra" };
  subtitles.overrides = ["mode"];
  assert.equal(normalizeRenderContract(input.raw, input.session, input.scenes, input.takes).style_snapshot.subtitle.mode, "palabra");
  const unknown = fixture();
  Object.assign(unknown.raw.style_snapshot.subtitle, { mode: "karaoke" });
  assert.throws(() => normalizeRenderContract(unknown.raw, unknown.session, unknown.scenes, unknown.takes), /modo de subtítulos/);
});

test("the Segmenta style uses natural pauses and the scene script comes from the database, not the browser", () => {
  const input = fixture(1, 10_000, "segmenta-cinetico");
  Object.assign(input.raw.clips[0], { script: "Texto inyectado por el navegador" });
  const output = normalizeRenderContract(input.raw, input.session, input.scenes, input.takes);
  assert.equal(output.dead_air.mode, "natural");
  assert.equal(output.clips[0].script, "Texto real de la escena 1");
  const other = fixture();
  assert.equal(normalizeRenderContract(other.raw, other.session, other.scenes, other.takes).dead_air.mode, "compacto", "other styles keep their compact cuts");
  const recortes = other.raw.skill_profiles.find((profile) => profile.id === "recortes")!;
  recortes.settings = { ...recortes.settings, mode: "natural" };
  recortes.overrides = ["mode"];
  assert.equal(normalizeRenderContract(other.raw, other.session, other.scenes, other.takes).dead_air.mode, "natural");
  const invalid = fixture();
  Object.assign(invalid.raw.dead_air, { mode: "agresivo" });
  assert.throws(() => normalizeRenderContract(invalid.raw, invalid.session, invalid.scenes, invalid.takes), /modo de pausas/);
});

test("a song from this production's music folder rides along; foreign songs or music without a song are refused", () => {
  const plain = fixture();
  const withoutMusic = normalizeRenderContract(plain.raw, plain.session, plain.scenes, plain.takes);
  assert.equal(withoutMusic.music, null);
  assert.equal(withoutMusic.effects.music, false);

  const input = fixture();
  const song = `${ownerId}/${sessionId}/music/0f6c2a1e-9b7d-4c1a-8f00-123456789abc.m4a`;
  const raw = input.raw as Record<string, unknown>;
  raw.music = { object_key: song, name: "Tema propio", volume: .3, ducking: false };
  const normalized = normalizeRenderContract(input.raw, input.session, input.scenes, input.takes);
  assert.deepEqual(normalized.music, { object_key: song, name: "Tema propio", volume: .3, ducking: false, fade_out_seconds: 2, start_seconds: 0 });
  assert.equal(normalized.effects.music, true);

  const foreign = fixture();
  (foreign.raw as Record<string, unknown>).music = { object_key: `someone-else/${sessionId}/music/0f6c2a1e-9b7d-4c1a.mp3` };
  assert.throws(() => normalizeRenderContract(foreign.raw, foreign.session, foreign.scenes, foreign.takes), /no pertenece/);

  const missing = fixture();
  missing.raw.effects.music = true;
  assert.throws(() => normalizeRenderContract(missing.raw, missing.session, missing.scenes, missing.takes), /Elige una canción/);
});
