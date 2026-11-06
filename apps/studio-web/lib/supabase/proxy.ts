import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicAuthPath, isStudioHost } from "../host-access";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  const { data } = await supabase.auth.getClaims();
  const pathname = request.nextUrl.pathname;
  const host = isStudioHost(data?.claims, process.env.STUDIO_HOST_EMAIL);
  let destination: NextResponse;

  if (pathname === "/login" && host && request.nextUrl.searchParams.get("reset") !== "1") {
    destination = NextResponse.redirect(new URL("/", request.url));
  } else if (host || isPublicAuthPath(pathname)) {
    return response;
  } else if (pathname.startsWith("/api/")) {
    destination = NextResponse.json({ error: "Inicia sesión con la cuenta anfitriona." }, { status: 401 });
  } else {
    destination = NextResponse.redirect(new URL("/login", request.url));
  }

  response.cookies.getAll().forEach(({ name, value, ...options }) => destination.cookies.set(name, value, options));
  destination.headers.set("Cache-Control", "private, no-store");
  return destination;
}
