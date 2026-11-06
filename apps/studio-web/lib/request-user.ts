import { createClient } from "./supabase/server";
import { isStudioHost } from "./host-access";

export type RequestUser = { userId: string; email: string; displayName: string };

export async function getRequestUser(): Promise<RequestUser | null> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user || !isStudioHost({ email: user.email, is_anonymous: user.is_anonymous, role: "authenticated" }, process.env.STUDIO_HOST_EMAIL)) return null;
  const email = user.email!;
  const displayName = String(user.user_metadata?.full_name || user.user_metadata?.name || email.split("@")[0]);
  return { userId: user.id, email, displayName };
}

export function unauthorized() {
  return Response.json({ error: "Debes iniciar sesión para abrir este estudio." }, { status: 401 });
}
