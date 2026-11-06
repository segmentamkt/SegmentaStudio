import { cookies } from "next/headers";
import { createClient } from "../../../../lib/supabase/server";
import { getRequestUser, unauthorized } from "../../../../lib/request-user";
import { validAccountPassword } from "../../../../lib/account-auth";
import { validRecoveryToken } from "../../../../lib/recovery-token";

export async function POST(request: Request) {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Origen no válido." }, { status: 403 });
  const cookieStore = await cookies();
  if (!validRecoveryToken(cookieStore.get("studio_recovery")?.value, user.userId, process.env.STUDIO_RECOVERY_SECRET)) {
    return Response.json({ error: "El enlace de recuperación no está activo o venció." }, { status: 403 });
  }
  const payload = await request.json().catch(() => null) as { password?: unknown } | null;
  const password = typeof payload?.password === "string" ? payload.password : "";
  if (!validAccountPassword(password)) return Response.json({ error: "La contraseña debe tener entre 8 y 72 caracteres." }, { status: 400 });
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return Response.json({ error: "No pudimos guardar la contraseña. Solicita otro enlace." }, { status: 400 });
  cookieStore.delete("studio_recovery");
  return Response.json({ updated: true }, { headers: { "Cache-Control": "private, no-store" } });
}
