import { createClient } from "../../../lib/supabase/server";
import { getRequestUser, unauthorized } from "../../../lib/request-user";
import { clean, toTake } from "../../../lib/studio-data";
import { assertTakeCanBeApproved, MediaReviewError } from "../../../lib/media-review";
import { invalidateMediaReview } from "../../../lib/media-review-server";
import { registerUploadedTake, TakeRegistrationError, type RegisteredTake, type TakeRegistrationRepository } from "../../../lib/take-registration";
import { z } from "zod";

const statuses = new Set(["pending", "approved", "blooper", "rejected"]);

export async function POST(request: Request) {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  try {
    const payload = await request.json() as Record<string, unknown>;
    const sceneId = clean(payload.sceneId);
    const sessionId = clean(payload.sessionId);
    const objectKey = clean(payload.objectKey);
    const requestedStatus = clean(payload.status, "pending");
    const status = statuses.has(requestedStatus) ? requestedStatus : "pending";
    const bytes = Math.max(0, Number(payload.bytes || 0));
    const durationMs = Math.max(0, Number(payload.durationMs || 0));
    const mimeType = clean(payload.mimeType, "video/mp4");
    if (!objectKey.startsWith(`${user.userId}/${sessionId}/${sceneId}/`)) return Response.json({ error: "La ruta del video no corresponde a esta cuenta." }, { status: 400 });
    const supabase = await createClient();
    if (payload.takeId !== undefined && !z.string().uuid().safeParse(payload.takeId).success) return Response.json({ error: "El identificador de la toma no es válido." }, { status: 400 });
    if (!Number.isFinite(bytes) || !Number.isFinite(durationMs)) return Response.json({ error: "El tamaño o la duración del video no son válidos." }, { status: 400 });
    const id = payload.takeId === undefined ? crypto.randomUUID() : String(payload.takeId);
    const repository: TakeRegistrationRepository = {
      async getScene(ownerId, projectId, targetSceneId) {
        const { data, error } = await supabase.from("kiko_scenes").select("id,selected_take_id").eq("id", targetSceneId).eq("session_id", projectId).eq("owner_id", ownerId).maybeSingle();
        if (error) throw error;
        return data;
      },
      async getTake(ownerId, takeId) {
        const { data, error } = await supabase.from("kiko_takes").select("*").eq("id", takeId).eq("owner_id", ownerId).maybeSingle();
        if (error) throw error;
        return data as RegisteredTake | null;
      },
      async listSceneTakes(ownerId, targetSceneId) {
        const { data, error } = await supabase.from("kiko_takes").select("id,scene_id,status").eq("owner_id", ownerId).eq("scene_id", targetSceneId);
        if (error) throw error;
        return data || [];
      },
      async insertTake(row) {
        const { data, error } = await supabase.from("kiko_takes").insert(row).select().single();
        if (error) throw error;
        return data as RegisteredTake;
      },
      invalidateReview: (ownerId, projectId) => invalidateMediaReview(supabase, ownerId, projectId),
      async selectTakeIfEmpty(ownerId, projectId, targetSceneId, takeId) {
        const { error } = await supabase.from("kiko_scenes").update({ selected_take_id: takeId }).eq("id", targetSceneId).eq("session_id", projectId).eq("owner_id", ownerId).is("selected_take_id", null);
        if (error) throw error;
      },
    };
    const result = await registerUploadedTake(repository, { id, owner_id: user.userId, session_id: sessionId, scene_id: sceneId, object_key: objectKey, mime_type: mimeType, bytes, duration_ms: Math.round(durationMs), status });
    return Response.json({ take: toTake(result.take), reused: result.reused }, { status: result.reused ? 200 : 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo registrar la toma." }, { status: error instanceof MediaReviewError || error instanceof TakeRegistrationError ? error.status : 500 });
  }
}

export async function PATCH(request: Request) {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  try {
    const payload = await request.json() as { id?: string; status?: string };
    const status = String(payload.status || "");
    if (!statuses.has(status)) return Response.json({ error: "Estado de toma no válido." }, { status: 400 });
    const supabase = await createClient();
    const found = await supabase.from("kiko_takes").select("*").eq("id", String(payload.id || "")).eq("owner_id", user.userId).maybeSingle();
    if (found.error) throw found.error;
    if (!found.data) return Response.json({ error: "No encontramos esa toma." }, { status: 404 });
    if (status === "approved") {
      const alternatives = await supabase.from("kiko_takes").select("id,scene_id,status").eq("owner_id", user.userId).eq("scene_id", found.data.scene_id);
      if (alternatives.error) throw alternatives.error;
      assertTakeCanBeApproved(found.data.id, found.data.scene_id, alternatives.data || []);
    }
    await invalidateMediaReview(supabase, user.userId, found.data.session_id);
    if (status === "approved") {
      const selected = await supabase.from("kiko_scenes").update({ selected_take_id: found.data.id }).eq("id", found.data.scene_id).eq("owner_id", user.userId);
      if (selected.error) throw selected.error;
    } else {
      const selected = await supabase.from("kiko_scenes").update({ selected_take_id: null }).eq("id", found.data.scene_id).eq("selected_take_id", found.data.id).eq("owner_id", user.userId);
      if (selected.error) throw selected.error;
    }
    const updated = await supabase.from("kiko_takes").update({ status }).eq("id", found.data.id).eq("owner_id", user.userId).select().single();
    if (updated.error) throw updated.error;
    return Response.json({ take: toTake(updated.data) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo actualizar la toma." }, { status: error instanceof MediaReviewError ? error.status : 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  try {
    const payload = await request.json() as { id?: string };
    const supabase = await createClient();
    const found = await supabase.from("kiko_takes").select("*").eq("id", String(payload.id || "")).eq("owner_id", user.userId).maybeSingle();
    if (found.error) throw found.error;
    if (!found.data) return Response.json({ error: "No encontramos esa toma." }, { status: 404 });
    await invalidateMediaReview(supabase, user.userId, found.data.session_id);
    const removed = await supabase.storage.from("kiko-videos").remove([found.data.object_key]);
    if (removed.error) throw removed.error;
    const selected = await supabase.from("kiko_scenes").update({ selected_take_id: null }).eq("id", found.data.scene_id).eq("selected_take_id", found.data.id).eq("owner_id", user.userId);
    if (selected.error) throw selected.error;
    const deleted = await supabase.from("kiko_takes").delete().eq("id", found.data.id).eq("owner_id", user.userId);
    if (deleted.error) throw deleted.error;
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo eliminar la toma." }, { status: 500 });
  }
}
