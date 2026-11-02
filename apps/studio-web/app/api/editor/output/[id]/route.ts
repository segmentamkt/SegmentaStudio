import { NextResponse } from "next/server";
import { createClient } from "../../../../../lib/supabase/server";
import { getRequestUser } from "../../../../../lib/request-user";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser();
  if (!user) return new Response("No autorizado", { status: 401 });
  const { id } = await context.params;
  const supabase = await createClient();
  const job = await supabase.from("kiko_edit_jobs").select("result_object_key").eq("id", id).eq("owner_id", user.userId).maybeSingle();
  if (job.error || !job.data?.result_object_key) return new Response("Render no disponible", { status: 404 });
  const signed = await supabase.storage.from("kiko-videos").createSignedUrl(job.data.result_object_key, 3600);
  if (signed.error || !signed.data) return new Response("No se pudo abrir el render", { status: 500 });
  return NextResponse.redirect(signed.data.signedUrl);
}
