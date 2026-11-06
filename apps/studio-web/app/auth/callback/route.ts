import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { sameOriginRedirect } from "../../../lib/account-auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedNext = url.searchParams.get("next") || "/";
  const next = sameOriginRedirect(url.origin, requestedNext);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(next);
  }

  return NextResponse.redirect(new URL("/login?error=oauth", url.origin));
}
