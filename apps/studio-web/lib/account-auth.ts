/** Keep the anonymous user's ID when adding a recoverable email/password login. */
export function confirmedEmail(user: { email?: string; email_confirmed_at?: string; is_anonymous?: boolean } | null, email: string) {
  return Boolean(user && !user.is_anonymous && user.email_confirmed_at && user.email?.toLowerCase() === email.trim().toLowerCase());
}

export function validAccountPassword(password: string) {
  return password.length >= 8 && password.length <= 72;
}

export function sameOriginRedirect(origin: string, requested: string) {
  try {
    const candidate = new URL(requested || "/", origin);
    return candidate.origin === origin ? candidate : new URL("/", origin);
  } catch {
    return new URL("/", origin);
  }
}

/** Older account emails must still reach the password form after login became mandatory. */
export function authCallbackRedirect(origin: string, requested: string) {
  const destination = sameOriginRedirect(origin, requested);
  const access = destination.searchParams.get("access");
  if (destination.pathname === "/" && (access === "setup" || access === "reset")) {
    return new URL("/login?reset=1", origin);
  }
  return destination;
}

/** Show actionable categories, never provider messages that may contain account details. */
export function accountAuthErrorMessage(error: unknown) {
  const failure = error && typeof error === "object" ? error as { code?: unknown; status?: unknown; name?: unknown } : {};
  if (failure.code === "invalid_credentials") {
    return "El correo o la contraseña no coinciden. Revisa los datos o usa «Olvidé mi contraseña».";
  }
  if (failure.code === "email_not_confirmed") {
    return "Confirma tu correo antes de entrar. Revisa el enlace de verificación que recibiste.";
  }
  if (failure.status === 429 || failure.code === "over_request_rate_limit" || failure.code === "over_email_send_rate_limit") {
    return "Se hicieron demasiados intentos. Espera unos minutos y vuelve a intentarlo.";
  }
  if (failure.code === "email_provider_disabled" || failure.code === "signup_disabled" || failure.code === "provider_disabled" || failure.code === "email_address_not_authorized") {
    return "El acceso por correo no está disponible en este momento. Inténtalo más tarde.";
  }
  if (failure.code === "request_timeout" || failure.name === "AuthRetryableFetchError" || failure.name === "TypeError" || failure.status === 0 || (typeof failure.status === "number" && failure.status >= 500)) {
    return "No pudimos conectar con el servicio de acceso. Revisa tu conexión e inténtalo de nuevo en unos minutos.";
  }
  return "No pudimos completar el acceso. Inténtalo de nuevo.";
}
