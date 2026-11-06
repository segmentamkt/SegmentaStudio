import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { sameOriginRedirect } from "../../../lib/account-auth";
import { createRecoveryToken } from "../../../lib/recovery-token";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedNext = url.searchParams.get("next") || "/";
  const next = sameOriginRedirect(url.origin, requestedNext);

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = NextResponse.redirect(next);
      if (next.pathname === "/login" && next.searchParams.get("reset") === "1" && data.user?.id && process.env.STUDIO_RECOVERY_SECRET) {
        response.cookies.set("studio_recovery", createRecoveryToken(data.user.id, process.env.STUDIO_RECOVERY_SECRET), {
          httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/reset", maxAge: 600,
        });
      }
      return response;
    }
  }

  return NextResponse.redirect(new URL("/login?error=oauth", url.origin));
}
