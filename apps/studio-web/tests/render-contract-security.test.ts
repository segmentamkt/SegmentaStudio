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

test("allows exactly 12 clips and 120 known seconds, then rejects either excess", () => {
  const atLimit = fixture(12, 10_000);
  assert.equal(normalizeRenderContract(atLimit.raw, atLimit.session, atLimit.scenes, atLimit.takes).clips.length, 12);

  const tooMany = fixture(13, 1_000);
  assert.throws(() => normalizeRenderContract(tooMany.raw, tooMany.session, tooMany.scenes, tooMany.takes), /hasta 12 tomas/);

  const tooLong = fixture(2, 60_001);
  assert.throws(() => normalizeRenderContract(tooLong.raw, tooLong.session, tooLong.scenes, tooLong.takes), /120 segundos/);
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

test("requires the saved script and invalidates an older plan when it changes", () => {
  const input = fixture();
  input.session.script = "Nuevo libreto";
  assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /libreto cambió/);
  input.raw.session.script = "Nuevo libreto";
  assert.equal(normalizeRenderContract(input.raw, input.session, input.scenes, input.takes).session.script, "Nuevo libreto");
  input.session.script = "";
  assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /libreto completo/);
});

test("only accepts the supported silence sensitivity levels", () => {
  const input = fixture(2);
  Object.assign(input.raw.dead_air, { noise_db: -25 });
  assert.equal(normalizeRenderContract(input.raw, input.session, input.scenes, input.takes).dead_air.noise_db, -25);
  Object.assign(input.raw.dead_air, { noise_db: -21 });
  assert.throws(() => normalizeRenderContract(input.raw, input.session, input.scenes, input.takes), /sensibilidad de silencio/);
});
