import { NextResponse } from "next/server";
import { createClient } from "../../../../../lib/supabase/server";
import { getRequestUser } from "../../../../../lib/request-user";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser();
  if (!user) return new Response("No autorizado", { status: 401 });
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return new Response("ID de render inválido", { status: 400 });
  const supabase = await createClient();
  const job = await supabase.from("kiko_edit_jobs").select("result_object_key").eq("id", id).eq("owner_id", user.userId).maybeSingle();
  const tableUnavailable = job.error && (job.error.code === "42P01" || job.error.message.includes("kiko_edit_jobs"));
  if (job.error && !tableUnavailable) return new Response("No se pudo consultar el render", { status: 500 });
  const objectKey = tableUnavailable ? `${user.userId}/renders/${id}.mp4` : job.data?.result_object_key;
  if (!objectKey) return new Response("Render no disponible", { status: 404 });
  const signed = await supabase.storage.from("kiko-videos").createSignedUrl(objectKey, 3600);
  if (signed.error || !signed.data) return new Response("No se pudo abrir el render", { status: 500 });
  return NextResponse.redirect(signed.data.signedUrl);
}
