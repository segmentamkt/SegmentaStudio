import { createClient } from "./supabase/server";

export type RequestUser = { userId: string; email: string; displayName: string };

export async function getRequestUser(): Promise<RequestUser | null> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const email = user.email || "visitante@segmenta.local";
  const displayName = String(user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "Visitante");
  return { userId: user.id, email, displayName };
}

export function unauthorized() {
  return Response.json({ error: "Debes iniciar sesión para abrir este estudio." }, { status: 401 });
}
