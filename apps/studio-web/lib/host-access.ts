type AccessClaims = {
  email?: unknown;
  is_anonymous?: unknown;
  role?: unknown;
} | null | undefined;

export function isStudioHost(claims: AccessClaims, configuredEmail: string | undefined) {
  const hostEmail = configuredEmail?.trim().toLowerCase();
  return Boolean(
    hostEmail &&
    claims?.role === "authenticated" &&
    claims.is_anonymous === false &&
    typeof claims.email === "string" &&
    claims.email.trim().toLowerCase() === hostEmail,
  );
}

export function isPublicAuthPath(pathname: string) {
  return ["/login", "/auth/callback", "/manifest.webmanifest", "/sw.js", "/offline.html"].includes(pathname);
}
