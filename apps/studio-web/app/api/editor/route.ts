import { createClient } from "../../../lib/supabase/server";
import { getRequestUser, unauthorized } from "../../../lib/request-user";
import { getEditorStyle } from "../../../lib/editor-presets";
import { clean, toEditJob } from "../../../lib/studio-data";

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
  transition?: "cut" | "fade" | "dissolve";
  soundEffectVolume?: number;
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
  let query = supabase.from("kiko_edit_jobs").select("*").eq("owner_id", user.userId);
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
    const payload = await request.json() as Record<string, unknown>;
    const sessionId = clean(payload.sessionId);
    const objective = clean(payload.objective, "Crear un video vertical claro, dinámico y profesional.");
    const style = getEditorStyle(payload.style);
    const options = (payload.options || {}) as EditOptions;
    const settings = (payload.settings || {}) as EditSettings;
    const supabase = await createClient();
    const session = await supabase.from("kiko_recording_sessions").select("*").eq("id", sessionId).eq("owner_id", user.userId).maybeSingle();
    if (session.error) throw session.error;
    if (!session.data) return Response.json({ error: "No encontramos esa producción." }, { status: 404 });
    const [scenes, takes] = await Promise.all([
      supabase.from("kiko_scenes").select("*").eq("session_id", sessionId).eq("owner_id", user.userId).order("position"),
      supabase.from("kiko_takes").select("*").eq("session_id", sessionId).eq("owner_id", user.userId).eq("status", "approved"),
    ]);
    if (scenes.error) throw scenes.error;
    if (takes.error) throw takes.error;
    const approved = new Map((takes.data || []).map((take) => [take.id, take]));
    const ordered = (scenes.data || []).map((scene) => ({ scene, take: approved.get(scene.selected_take_id) })).filter((item) => item.take);
    if (!ordered.length) return Response.json({ error: "Aprueba al menos una toma antes de planificar la edición." }, { status: 400 });
    const normalizedOptions = {
      captions: options.captions !== false,
      deadAir: options.deadAir !== false,
      transitions: options.transitions !== false,
      soundEffects: options.soundEffects !== false,
      labels: options.labels !== false,
      broll: options.broll === true,
    };
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
      },
    };
    const contract = {
      schema: "kiko.edit-contract.v1",
      objective,
      session: { id: session.data.id, title: session.data.title, script: session.data.script },
      ordered_clip_ids: ordered.map((item) => item.take.id),
      clips: ordered.map(({ scene, take }) => ({
        id: take.id,
        scene_id: scene.id,
        name: scene.title,
        object_key: take.object_key,
        duration_seconds: Number(take.duration_ms || 0) / 1000,
        transcript: scene.script,
      })),
      style: style.id,
      style_snapshot: styleSnapshot,
      target_duration_seconds: null,
      captions: { enabled: normalizedOptions.captions, language: "es", max_words_per_card: styleSnapshot.subtitle.maxWords, emphasis: true },
      dead_air: { remove: normalizedOptions.deadAir, threshold_ms: styleSnapshot.execution.silenceThresholdMs },
      effects: {
        transitions: normalizedOptions.transitions,
        sound_effects: normalizedOptions.soundEffects,
        labels: normalizedOptions.labels,
        images_or_broll: normalizedOptions.broll,
        music: false,
      },
      quality_gates: { portrait: true, audio: true, captions: normalizedOptions.captions, effects: normalizedOptions.transitions || normalizedOptions.labels },
    };
    const inserted = await supabase.from("kiko_edit_jobs").insert({
      id: crypto.randomUUID(), owner_id: user.userId, session_id: sessionId, style: style.id,
      objective, status: "planned", stage: "Plan editorial listo", progress: 8, contract,
    }).select().single();
    if (inserted.error) {
      if (inserted.error.code === "42P01" || inserted.error.message.includes("kiko_edit_jobs")) {
        return Response.json({ job: { id: crypto.randomUUID(), ownerId: user.userId, sessionId, style: style.id, objective, status: "planned", stage: "Plan editorial listo", progress: 8, contract, resultMetadata: {}, error: null, ephemeral: true } }, { status: 201 });
      }
      throw inserted.error;
    }
    return Response.json({ job: toEditJob(inserted.data) }, { status: 201 });
  } catch (error) {
    console.error("editor plan creation failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo preparar la edición." }, { status: 500 });
  }
}
