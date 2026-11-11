import { createClient } from "../../../lib/supabase/server";
import { getRequestUser, unauthorized } from "../../../lib/request-user";
import { getEditorStyle } from "../../../lib/editor-presets";
import { clean, toEditJob } from "../../../lib/studio-data";
import { applySkillProfilesToContract } from "../../../lib/studio-skills";
import { planFromScript } from "../../../lib/editorial-director";
import { MAX_WORDS_PER_CUE, sanitizeCueWords, type CaptionCue } from "../../../lib/caption-cues";
import { MediaReviewError, requireCurrentMediaReview } from "../../../lib/media-review";
import { readMediaReview } from "../../../lib/media-review-server";
import { normalizeVisualResources, validateVisualResourceBudget, type VisualResource } from "../../../lib/visual-resources";
import { normalizeMusicTrack, type MusicTrack } from "../../../lib/music-bed";

type EditOptions = {
  captions?: boolean;
  deadAir?: boolean;
  transitions?: boolean;
  soundEffects?: boolean;
  labels?: boolean;
  broll?: boolean;
};

type EditSettings = {
  subtitleSize?: number;
  subtitlePosition?: "top" | "center" | "bottom";
  silenceThresholdMs?: number;
  silenceNoiseDb?: number;
  transition?: "cut" | "fade" | "dissolve";
  soundEffectVolume?: number;
  soundPreset?: "auto" | "none" | "soft" | "kinetic" | "cinematic" | "pop";
  noiseReduction?: "off" | "light" | "medium";
};

type TimelineItem = {
  takeId: string;
  included?: boolean;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
  playbackSpeed?: number;
  audioVolume?: number;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  transcript?: string;
  label?: string;
  captionCues?: CaptionCue[];
  visualResources?: unknown;
  resourcesReviewed?: boolean;
};

function bounded(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export async function GET(request: Request) {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  const id = new URL(request.url).searchParams.get("id");
  const supabase = await createClient();
  let query = supabase.from("kiko_edit_jobs").select("*").eq("owner_id", user.userId).not("status", "in", "(preproduction,media_review,media_review_stale)");
  query = id ? query.eq("id", id) : query.order("updated_at", { ascending: false });
  const result = id ? await query.maybeSingle() : await query;
  if (result.error) {
    if (result.error.code === "42P01" || result.error.message.includes("kiko_edit_jobs")) {
      return id ? Response.json({ error: "Ese plan temporal ya no está en esta sesión." }, { status: 404 }) : Response.json({ jobs: [] });
    }
    console.error("editor job lookup failed", result.error);
    return Response.json({ error: result.error.message }, { status: 500 });
  }
  if (id) return result.data ? Response.json({ job: toEditJob(result.data) }) : Response.json({ error: "No encontramos ese trabajo." }, { status: 404 });
  return Response.json({ jobs: (result.data || []).map(toEditJob) });
}

export async function POST(request: Request) {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  try {
    // Inline uploaded images are allowed only within this bounded JSON envelope.
    const maxBodyBytes = 2.5 * 1024 * 1024;
    if (Number(request.headers.get("content-length")) > maxBodyBytes) return Response.json({ error: "Las imágenes de esta edición superan el tamaño permitido." }, { status: 413 });
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: "Faltan los datos de la edición." }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let bodyBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bodyBytes += value.byteLength;
      if (bodyBytes > maxBodyBytes) {
        await reader.cancel();
        return Response.json({ error: "Las imágenes de esta edición superan el tamaño permitido." }, { status: 413 });
      }
      chunks.push(value);
    }
    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Formato no válido");
      payload = parsed as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Los datos de la edición no tienen un formato válido." }, { status: 400 });
    }
    const sessionId = clean(payload.sessionId);
    const objective = clean(payload.objective, "Crear un video vertical claro, dinámico y profesional.");
    if (objective.length > 2_000) return Response.json({ error: "La indicación de edición admite hasta 2.000 caracteres." }, { status: 400 });
    const style = getEditorStyle(payload.style);
    const options = (payload.options || {}) as EditOptions;
    const settings = (payload.settings || {}) as EditSettings;
    const supabase = await createClient();
    const session = await supabase.from("kiko_recording_sessions").select("*").eq("id", sessionId).eq("owner_id", user.userId).maybeSingle();
    if (session.error) throw session.error;
    if (!session.data) return Response.json({ error: "No encontramos esa producción." }, { status: 404 });
    if (String(session.data.title || "").length > 160 || String(session.data.script || "").length > 6_000) return Response.json({ error: "Acorta el título o el libreto de esta producción antes de editarla." }, { status: 400 });
    const [scenes, takes] = await Promise.all([
      supabase.from("kiko_scenes").select("*").eq("session_id", sessionId).eq("owner_id", user.userId).order("position"),
      supabase.from("kiko_takes").select("*").eq("session_id", sessionId).eq("owner_id", user.userId),
    ]);
    if (scenes.error) throw scenes.error;
    if (takes.error) throw takes.error;
    const review = requireCurrentMediaReview(await readMediaReview(supabase, user.userId, sessionId, scenes.data || [], takes.data || []));
    const approved = new Map((takes.data || []).filter((take) => take.status === "approved").map((take) => [take.id, take]));
    const source = (scenes.data || []).map((scene) => ({ scene, take: approved.get(scene.selected_take_id) })).filter((item) => item.take);
    const requestedTimeline = payload.timeline === undefined ? null : payload.timeline;
    if (requestedTimeline !== null && (!Array.isArray(requestedTimeline) || requestedTimeline.length > 500 || requestedTimeline.some((item) => !item || typeof item !== "object" || typeof item.takeId !== "string" || (item.included !== undefined && typeof item.included !== "boolean")))) {
      return Response.json({ error: "La línea de tiempo no tiene un formato válido." }, { status: 400 });
    }
    const timeline = requestedTimeline === null ? null : (requestedTimeline as TimelineItem[]).filter((item) => item.included !== false);
    const byTakeId = new Map(source.map((item) => [item.take!.id, item]));
    if (timeline?.some((item) => !byTakeId.has(item.takeId))) return Response.json({ error: "La línea de tiempo contiene una toma no aprobada." }, { status: 400 });
    let music: MusicTrack | null;
    try { music = normalizeMusicTrack(payload.music, user.userId, sessionId); }
    catch (reason) { return Response.json({ error: reason instanceof Error ? reason.message : "La música no es válida." }, { status: 400 }); }
    const ordered = timeline ? timeline.map((item) => ({ ...byTakeId.get(item.takeId)!, edit: item })) : source.map((item) => ({ ...item, edit: null as TimelineItem | null }));
    if (!ordered.length) return Response.json({ error: "Aprueba al menos una toma antes de planificar la edición." }, { status: 400 });
    if (ordered.length > 12) return Response.json({ error: "Este render cloud admite hasta 12 tomas aprobadas por edición." }, { status: 400 });
    const visualResources: VisualResource[][] = [];
    for (const { take, edit } of ordered) {
      const duration = Number(take.duration_ms || 0) / 1000;
      const start = edit?.trimStartSeconds ?? 0;
      const end = edit?.trimEndSeconds ?? duration;
      if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration || end - start < .2) {
        return Response.json({ error: "Revisa el inicio y el final del recorte de cada toma." }, { status: 400 });
      }
      for (const [value, min, max] of [[edit?.playbackSpeed, .5, 2], [edit?.audioVolume, 0, 2], [edit?.brightness, -.2, .2], [edit?.contrast, .8, 1.3], [edit?.saturation, .5, 1.5]] as const) {
        if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)) {
          return Response.json({ error: "Un ajuste de velocidad, audio o color está fuera de rango." }, { status: 400 });
        }
      }
      if (edit && (typeof edit.transcript !== "string" || typeof edit.label !== "string" || edit.label.length > 120 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(edit.transcript + edit.label))) {
        return Response.json({ error: "El texto o rótulo de una toma no es válido." }, { status: 400 });
      }
      if (edit?.captionCues !== undefined && (!Array.isArray(edit.captionCues) || edit.captionCues.length > 100 || edit.captionCues.some((cue) => !cue || typeof cue.text !== "string" || cue.text.length > 250 || typeof cue.startSeconds !== "number" || typeof cue.endSeconds !== "number" || !Number.isFinite(cue.startSeconds) || !Number.isFinite(cue.endSeconds) || cue.startSeconds < 0 || cue.endSeconds > duration || cue.endSeconds <= cue.startSeconds
        // Per-word timings (kinetic captions) are optional; reject only oversized payloads.
        || (cue.words !== undefined && (!Array.isArray(cue.words) || cue.words.length > MAX_WORDS_PER_CUE))))) {
        return Response.json({ error: "Los tiempos de subtítulos de una toma no son válidos." }, { status: 400 });
      }
      if (edit?.resourcesReviewed !== undefined && typeof edit.resourcesReviewed !== "boolean") {
        return Response.json({ error: "La revisión de recursos visuales no es válida." }, { status: 400 });
      }
      // Validate hidden/disabled resources too, so saved plans cannot retain unsafe media.
      try {
        visualResources.push(normalizeVisualResources(edit?.visualResources, { durationSeconds: duration, trimStartSeconds: start, trimEndSeconds: end }));
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Los recursos visuales de una toma no son válidos." }, { status: 400 });
      }
    }
    try {
      validateVisualResourceBudget(visualResources.flat());
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Hay demasiados recursos visuales en esta edición." }, { status: 400 });
    }
    if (ordered.reduce((total, item) => total + ((item.edit?.trimEndSeconds ?? Number(item.take?.duration_ms || 0) / 1000) - (item.edit?.trimStartSeconds ?? 0)) / (item.edit?.playbackSpeed ?? 1), 0) > 120) return Response.json({ error: "Este render cloud admite hasta 2 minutos de video final por edición." }, { status: 400 });
    if (ordered.some((item) => String(item.edit?.transcript ?? item.scene.script ?? "").length > 1_000) || ordered.reduce((total, item) => total + String(item.edit?.transcript ?? item.scene.script ?? "").length, 0) > 5_000) return Response.json({ error: "Acorta el texto hablado: hasta 1.000 caracteres por escena y 5.000 en total." }, { status: 400 });
    const normalizedOptions = {
      captions: options.captions === true,
      deadAir: options.deadAir !== false,
      transitions: options.transitions !== false,
      soundEffects: options.soundEffects !== false,
      labels: options.labels !== false,
      broll: options.broll === true,
    };
    if (normalizedOptions.captions && ordered.some(({ scene, edit }) => !String(edit?.transcript ?? scene.script ?? "").trim())) {
      return Response.json({ error: "Falta el texto hablado de una o más tomas. Complétalo en la línea de tiempo o desactiva subtítulos." }, { status: 400 });
    }
    if (normalizedOptions.captions && ordered.some(({ edit }) => !edit?.captionCues?.length)) {
      return Response.json({ error: "Cada toma necesita subtítulos con tiempos reales. Usa Escuchar y sincronizar o importa un SRT/VTT." }, { status: 400 });
    }
    const styleSnapshot = {
      ...style,
      transition: ["cut", "fade", "dissolve"].includes(String(settings.transition)) ? settings.transition : style.transition,
      subtitle: {
        ...style.subtitle,
        size: bounded(settings.subtitleSize, style.subtitle.size, 38, 100),
        position: ["top", "center", "bottom"].includes(String(settings.subtitlePosition)) ? settings.subtitlePosition : style.subtitle.position,
      },
      execution: {
        ...style.execution,
        silenceThresholdMs: bounded(settings.silenceThresholdMs, style.execution.silenceThresholdMs, 350, 1500),
        soundEffectVolume: bounded(settings.soundEffectVolume, style.execution.soundEffectVolume, 0, 1),
        soundPreset: ["auto", "none", "soft", "kinetic", "cinematic", "pop"].includes(String(settings.soundPreset)) ? settings.soundPreset : "auto",
        noiseReduction: ["off", "light", "medium"].includes(String(settings.noiseReduction)) ? settings.noiseReduction : "off",
      },
    };
    const contract = {
      schema: "kiko.edit-contract.v1",
      media_review: { id: review.id, fingerprint: review.fingerprint },
      objective,
      session: { id: session.data.id, title: session.data.title, script: session.data.script },
      ordered_clip_ids: ordered.map((item) => item.take.id),
      clips: ordered.map(({ scene, take, edit }, index) => ({
        id: take.id,
        scene_id: scene.id,
        name: scene.title,
        object_key: take.object_key,
        duration_seconds: Number(take.duration_ms || 0) / 1000,
        transcript: edit?.transcript ?? scene.script,
        trim_start_seconds: edit?.trimStartSeconds ?? 0,
        trim_end_seconds: edit?.trimEndSeconds ?? Number(take.duration_ms || 0) / 1000,
        playback_speed: edit?.playbackSpeed ?? 1,
        audio_volume: edit?.audioVolume ?? 1,
        brightness: edit?.brightness ?? 0,
        contrast: edit?.contrast ?? 1,
        saturation: edit?.saturation ?? 1,
        label: edit?.label ?? "",
        // Invalid word timings are dropped (the cue falls back to estimated timing), never stored.
        caption_cues: (edit?.captionCues ?? []).map((cue) => {
          const words = sanitizeCueWords(cue.words, cue);
          return { startSeconds: cue.startSeconds, endSeconds: cue.endSeconds, text: cue.text, ...(words ? { words } : {}) };
        }),
        visual_resources: visualResources[index],
        visual_resources_reviewed: edit?.resourcesReviewed === true,
      })),
      style: style.id,
      style_snapshot: styleSnapshot,
      target_duration_seconds: null,
      captions: { enabled: normalizedOptions.captions, language: "es", max_words_per_card: styleSnapshot.subtitle.maxWords, emphasis: true },
      dead_air: { remove: normalizedOptions.deadAir, threshold_ms: styleSnapshot.execution.silenceThresholdMs, noise_db: [-35, -30, -25].includes(Number(settings.silenceNoiseDb)) ? Number(settings.silenceNoiseDb) : -30 },
      effects: {
        transitions: normalizedOptions.transitions,
        sound_effects: normalizedOptions.soundEffects,
        labels: normalizedOptions.labels,
        images_or_broll: normalizedOptions.broll,
        music: Boolean(music),
      },
      music,
      quality_gates: { portrait: true, audio: true, captions: normalizedOptions.captions, timed_captions: normalizedOptions.captions, images: normalizedOptions.broll && visualResources.some((resources) => resources.length > 0), effects: normalizedOptions.transitions || normalizedOptions.labels },
      editorial_plan: planFromScript(String(session.data.script), ordered.map(({ scene, take, edit }) => ({ id: take.id, title: String(scene.title || ""), transcript: String(edit?.transcript ?? scene.script ?? "") }))),
    };
    const contractWithSkills = applySkillProfilesToContract(contract, payload.skillProfiles);
    const inserted = await supabase.from("kiko_edit_jobs").insert({
      id: crypto.randomUUID(), owner_id: user.userId, session_id: sessionId, style: style.id,
      objective, status: "planned", stage: "Plan editorial listo", progress: 8, contract: contractWithSkills,
    }).select().single();
    if (inserted.error) {
      if (inserted.error.code === "42P01" || inserted.error.message.includes("kiko_edit_jobs")) {
        return Response.json({ job: { id: crypto.randomUUID(), ownerId: user.userId, sessionId, style: style.id, objective, status: "planned", stage: "Plan editorial listo", progress: 8, contract: contractWithSkills, resultMetadata: {}, error: null, ephemeral: true } }, { status: 201 });
      }
      throw inserted.error;
    }
    return Response.json({ job: toEditJob(inserted.data) }, { status: 201 });
  } catch (error) {
    console.error("editor plan creation failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo preparar la edición." }, { status: error instanceof MediaReviewError ? error.status : 500 });
  }
}
