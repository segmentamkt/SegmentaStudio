import { createClient } from "../../../lib/supabase/server";
import { getRequestUser, unauthorized } from "../../../lib/request-user";
import { clean, scriptScenes, toAccount, toEditJob, toPortfolio, toScene, toSession, toTake } from "../../../lib/studio-data";

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
    return Response.json({ user, accounts: (accounts.data || []).map(toAccount), portfolios: (portfolios.data || []).map(toPortfolio), sessions: (sessions.data || []).map(toSession), scenes: (scenes.data || []).map(toScene), takes: (takes.data || []).map(toTake), editJobs: (editJobs.data || []).map(toEditJob) });
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
      const portfolioId = clean(payload.portfolioId);
      const owned = await supabase.from("kiko_portfolios").select("id").eq("id", portfolioId).eq("owner_id", user.userId).maybeSingle();
      if (!owned.data) return Response.json({ error: "Ese portafolio no está disponible." }, { status: 404 });
      const title = clean(payload.title, "Nueva producción");
      const script = clean(payload.script);
      const id = crypto.randomUUID();
      const sessionResult = await supabase.from("kiko_recording_sessions").insert({ id, owner_id: user.userId, portfolio_id: portfolioId, title, script, status: "recording" }).select().single();
      if (sessionResult.error) throw sessionResult.error;
      const sceneValues = scriptScenes(script).map((sceneScript, position) => ({ id: crypto.randomUUID(), owner_id: user.userId, session_id: id, position, title: `Escena ${position + 1}`, script: sceneScript }));
      const scenesResult = await supabase.from("kiko_scenes").insert(sceneValues).select();
      if (scenesResult.error) throw scenesResult.error;
      return Response.json({ session: toSession(sessionResult.data), scenes: (scenesResult.data || []).map(toScene) }, { status: 201 });
    }
    if (action === "complete_session") {
      const result = await supabase.from("kiko_recording_sessions").update({ status: "ready_for_edit", updated_at: new Date().toISOString() }).eq("id", clean(payload.sessionId)).eq("owner_id", user.userId).select().maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return Response.json({ error: "No encontramos esa producción." }, { status: 404 });
      return Response.json({ session: toSession(result.data) });
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
