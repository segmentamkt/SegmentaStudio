import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { getRequestUser, unauthorized } from "../../../../lib/request-user";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  const supabase = await createClient();
  const take = await supabase.from("kiko_takes").select("object_key").eq("id", id).eq("owner_id", user.userId).maybeSingle();
  if (take.error) return Response.json({ error: take.error.message }, { status: 500 });
  if (!take.data) return Response.json({ error: "No encontramos esa toma." }, { status: 404 });
  const signed = await supabase.storage.from("kiko-videos").createSignedUrl(take.data.object_key, 3600);
  if (signed.error) return Response.json({ error: signed.error.message }, { status: 500 });
  return NextResponse.redirect(signed.data.signedUrl);
}
