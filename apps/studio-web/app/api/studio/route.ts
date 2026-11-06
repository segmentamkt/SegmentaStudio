import { createClient } from "../../../lib/supabase/server";
import { getRequestUser, unauthorized } from "../../../lib/request-user";
import { clean, toAccount, toEditJob, toPortfolio, toScene, toSession, toTake } from "../../../lib/studio-data";
import { preproductionSchema } from "../../../lib/preproduction-plan";

const accents = ["violet", "cyan", "rose", "amber"];

async function ensureStarter(ownerId: string, displayName: string) {
  const supabase = await createClient();
  const { data: existingAccount, error } = await supabase.from("kiko_brand_accounts").select("*").eq("owner_id", ownerId).limit(1).maybeSingle();
  let account = existingAccount;
  if (error) throw error;
  if (!account) {
    const result = await supabase.from("kiko_brand_accounts").insert({ id: crypto.randomUUID(), owner_id: ownerId, name: `${displayName} Studio`, handle: "@segmenta" }).select().single();
    if (result.error) throw result.error;
    account = result.data;
  }
  const portfolioResult = await supabase.from("kiko_portfolios").select("*").eq("owner_id", ownerId).eq("account_id", account.id).limit(1).maybeSingle();
  if (portfolioResult.error) throw portfolioResult.error;
  let portfolio = portfolioResult.data;
  if (!portfolio) {
    const result = await supabase.from("kiko_portfolios").insert({ id: crypto.randomUUID(), owner_id: ownerId, account_id: account.id, name: "Marca personal", niche: "Contenido educativo", essence: "Directo, humano y visual", accent: "violet" }).select().single();
    if (result.error) throw result.error;
    portfolio = result.data;
  }
  return { account, portfolio };
}

export async function GET() {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  try {
    await ensureStarter(user.userId, user.displayName);
    const supabase = await createClient();
    const [accounts, portfolios, sessions, scenes, takes] = await Promise.all([
      supabase.from("kiko_brand_accounts").select("*").eq("owner_id", user.userId).order("created_at"),
      supabase.from("kiko_portfolios").select("*").eq("owner_id", user.userId).order("created_at"),
      supabase.from("kiko_recording_sessions").select("*").eq("owner_id", user.userId).order("updated_at", { ascending: false }),
      supabase.from("kiko_scenes").select("*").eq("owner_id", user.userId).order("position"),
      supabase.from("kiko_takes").select("*").eq("owner_id", user.userId).order("created_at", { ascending: false }),
    ]);
    const failure = [accounts, portfolios, sessions, scenes, takes].find((result) => result.error)?.error;
    if (failure) throw failure;
    const editJobs = await supabase.from("kiko_edit_jobs").select("*").eq("owner_id", user.userId).order("updated_at", { ascending: false });
    if (editJobs.error) console.warn("edit jobs unavailable; using stateless fallback", editJobs.error.message);
    const jobs = (editJobs.data || []).map(toEditJob);
    return Response.json({ user, accounts: (accounts.data || []).map(toAccount), portfolios: (portfolios.data || []).map(toPortfolio), sessions: (sessions.data || []).map(toSession), scenes: (scenes.data || []).map(toScene), takes: (takes.data || []).map(toTake), preproductionPlans: jobs.filter((job) => job.status === "preproduction"), editJobs: jobs.filter((job) => job.status !== "preproduction") });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo abrir el estudio." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  try {
    const payload = await request.json() as Record<string, unknown>;
    const action = clean(payload.action);
    const supabase = await createClient();
    if (action === "create_portfolio") {
      const { account } = await ensureStarter(user.userId, user.displayName);
      const name = clean(payload.name);
      if (!name) return Response.json({ error: "Escribe un nombre para el portafolio." }, { status: 400 });
      const result = await supabase.from("kiko_portfolios").insert({ id: crypto.randomUUID(), owner_id: user.userId, account_id: account.id, name, niche: clean(payload.niche, "Marca personal"), essence: clean(payload.essence, "Claro, cercano y profesional"), accent: accents.includes(clean(payload.accent)) ? clean(payload.accent) : "violet" }).select().single();
      if (result.error) throw result.error;
      return Response.json({ portfolio: toPortfolio(result.data) }, { status: 201 });
    }
    if (action === "create_session") {
      const planResult = preproductionSchema.safeParse(payload.preproductionPlan);
      if (!planResult.success) return Response.json({ error: "Revisa y aprueba el plan de edición antes de crear el proyecto." }, { status: 400 });
      const plan = planResult.data;
      const portfolioId = clean(payload.portfolioId);
      const owned = await supabase.from("kiko_portfolios").select("id").eq("id", portfolioId).eq("owner_id", user.userId).maybeSingle();
      if (!owned.data) return Response.json({ error: "Ese portafolio no está disponible." }, { status: 404 });
      const title = clean(payload.title, "Nueva producción");
      const script = clean(payload.script);
      if (title.length > 160) return Response.json({ error: "El nombre del proyecto admite hasta 160 caracteres." }, { status: 400 });
      const hasSceneCount = payload.sceneCount !== undefined;
      const sceneCount = hasSceneCount ? Number(payload.sceneCount) : 0;
      if (hasSceneCount && (!Number.isInteger(sceneCount) || sceneCount < 1 || sceneCount > 12)) return Response.json({ error: "Puedes subir hasta 12 videos por proyecto." }, { status: 400 });
      if (script.length > 6_000) return Response.json({ error: "El libreto admite hasta 6.000 caracteres." }, { status: 400 });
      // Uploaded clips may arrive in any order: the complete script is a reference,
      // never a guessed transcript assigned to a file by its upload position.
      const sceneScripts = sceneCount ? Array.from({ length: sceneCount }, () => "") : plan.scenes.map((scene) => scene.spoken || "Idea por grabar");
      if (sceneScripts.some((item) => item.length > 1_000)) return Response.json({ error: "Cada escena admite hasta 1.000 caracteres de libreto." }, { status: 400 });
      const sceneTitles = sceneCount && Array.isArray(payload.sceneTitles) ? payload.sceneTitles : plan.scenes.map((scene) => scene.title);
      const id = crypto.randomUUID();
      const sessionResult = await supabase.from("kiko_recording_sessions").insert({ id, owner_id: user.userId, portfolio_id: portfolioId, title, script, status: "recording" }).select().single();
      if (sessionResult.error) throw sessionResult.error;
      const sceneValues = sceneScripts.map((sceneScript, position) => ({ id: crypto.randomUUID(), owner_id: user.userId, session_id: id, position, title: clean(sceneTitles[position], `Escena ${position + 1}`).slice(0, 80), script: sceneScript }));
      const scenesResult = await supabase.from("kiko_scenes").insert(sceneValues).select();
      if (scenesResult.error) {
        await supabase.from("kiko_recording_sessions").delete().eq("id", id).eq("owner_id", user.userId);
        throw scenesResult.error;
      }
      const planSaved = await supabase.from("kiko_edit_jobs").insert({
        id: crypto.randomUUID(), owner_id: user.userId, session_id: id, style: plan.style,
        objective: plan.description, status: "preproduction", stage: "Dirección aprobada antes de grabar", progress: 0,
        contract: plan,
      });
      if (planSaved.error) {
        await supabase.from("kiko_recording_sessions").delete().eq("id", id).eq("owner_id", user.userId);
        throw planSaved.error;
      }
      return Response.json({ session: toSession(sessionResult.data), scenes: (scenesResult.data || []).map(toScene) }, { status: 201 });
    }
    if (action === "update_preproduction_plan") {
      const sessionId = clean(payload.sessionId);
      const parsed = preproductionSchema.safeParse(payload.preproductionPlan);
      if (!parsed.success) return Response.json({ error: "El plan de edición tiene campos incompletos o inválidos." }, { status: 400 });
      const owned = await supabase.from("kiko_recording_sessions").select("id").eq("id", sessionId).eq("owner_id", user.userId).maybeSingle();
      if (!owned.data) return Response.json({ error: "No encontramos esa producción." }, { status: 404 });
      const existing = await supabase.from("kiko_edit_jobs").select("id").eq("session_id", sessionId).eq("owner_id", user.userId).eq("status", "preproduction").maybeSingle();
      if (existing.error) throw existing.error;
      const plan = parsed.data;
      const values = { style: plan.style, objective: plan.description, contract: plan, updated_at: new Date().toISOString() };
      const result = existing.data
        ? await supabase.from("kiko_edit_jobs").update(values).eq("id", existing.data.id).eq("owner_id", user.userId)
        : await supabase.from("kiko_edit_jobs").insert({ id: crypto.randomUUID(), owner_id: user.userId, session_id: sessionId, status: "preproduction", stage: "Dirección aprobada", progress: 0, ...values });
      if (result.error) throw result.error;
      return Response.json({ saved: true });
    }
    if (action === "complete_session") {
      const result = await supabase.from("kiko_recording_sessions").update({ status: "ready_for_edit", updated_at: new Date().toISOString() }).eq("id", clean(payload.sessionId)).eq("owner_id", user.userId).select().maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return Response.json({ error: "No encontramos esa producción." }, { status: 404 });
      return Response.json({ session: toSession(result.data) });
    }
    if (action === "update_session_script") {
      const sessionId = clean(payload.sessionId);
      const script = clean(payload.script);
      if (!script || script.length > 6_000) return Response.json({ error: "Sube o escribe un libreto de hasta 6.000 caracteres." }, { status: 400 });
      const result = await supabase.from("kiko_recording_sessions")
        .update({ script, updated_at: new Date().toISOString() })
        .eq("id", sessionId).eq("owner_id", user.userId).select().maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return Response.json({ error: "No encontramos esa producción." }, { status: 404 });
      return Response.json({ session: toSession(result.data) });
    }
    if (action === "update_scene_script") {
      const sceneId = clean(payload.sceneId);
      const script = clean(payload.script);
      if (script.length > 1_000) return Response.json({ error: "El texto de esta escena admite hasta 1.000 caracteres." }, { status: 400 });
      const result = await supabase.from("kiko_scenes").update({ script }).eq("id", sceneId).eq("owner_id", user.userId).select().maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return Response.json({ error: "No encontramos esa escena." }, { status: 404 });
      return Response.json({ scene: toScene(result.data) });
    }
    if (action === "add_scene") {
      const sessionId = clean(payload.sessionId);
      const owned = await supabase.from("kiko_recording_sessions").select("id").eq("id", sessionId).eq("owner_id", user.userId).maybeSingle();
      if (owned.error) throw owned.error;
      if (!owned.data) return Response.json({ error: "No encontramos esa producción." }, { status: 404 });
      const existing = await supabase.from("kiko_scenes").select("position").eq("session_id", sessionId).eq("owner_id", user.userId).order("position");
      if (existing.error) throw existing.error;
      if ((existing.data || []).length >= 12) return Response.json({ error: "Esta edición admite hasta 12 escenas." }, { status: 400 });
      const position = (existing.data || []).reduce((maximum, scene) => Math.max(maximum, Number(scene.position)), -1) + 1;
      const title = clean(payload.title, `Escena ${position + 1}`).slice(0, 80);
      const inserted = await supabase.from("kiko_scenes").insert({ id: crypto.randomUUID(), owner_id: user.userId, session_id: sessionId, position, title, script: "" }).select().single();
      if (inserted.error) throw inserted.error;
      return Response.json({ scene: toScene(inserted.data) }, { status: 201 });
    }
    return Response.json({ error: "Acción no reconocida." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo guardar el cambio." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  try {
    const { sessionId = "" } = await request.json() as { sessionId?: string };
    const supabase = await createClient();
    const owned = await supabase.from("kiko_takes").select("object_key").eq("owner_id", user.userId).eq("session_id", sessionId);
    if (owned.error) throw owned.error;
    const keys = (owned.data || []).map((item) => item.object_key);
    if (keys.length) {
      const removed = await supabase.storage.from("kiko-videos").remove(keys);
      if (removed.error) throw removed.error;
    }
    const deleted = await supabase.from("kiko_recording_sessions").delete().eq("owner_id", user.userId).eq("id", sessionId).select("id").maybeSingle();
    if (deleted.error) throw deleted.error;
    if (!deleted.data) return Response.json({ error: "No encontramos esa producción." }, { status: 404 });
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo eliminar la producción." }, { status: 500 });
  }
}
