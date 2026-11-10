import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // Local-only test bench for the editing room (never in production builds).
  if (process.env.NODE_ENV !== "production" && /^\/(sala-demo|_dev\/)/.test(request.nextUrl.pathname)) return NextResponse.next();
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ttf|woff2?)$).*)"],
};
