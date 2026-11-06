/** Keep the anonymous user's ID when adding a recoverable email/password login. */
export function confirmedEmail(user: { email?: string; email_confirmed_at?: string; is_anonymous?: boolean } | null, email: string) {
  return Boolean(user && !user.is_anonymous && user.email_confirmed_at && user.email?.toLowerCase() === email.trim().toLowerCase());
}

export function validAccountPassword(password: string) {
  return password.length >= 8 && password.length <= 72;
}

export function sameOriginRedirect(origin: string, requested: string) {
  const candidate = new URL(requested || "/", origin);
  return candidate.origin === origin ? candidate : new URL("/", origin);
}
