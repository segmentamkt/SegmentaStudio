import assert from "node:assert/strict";
import test from "node:test";
import { accountAuthErrorMessage, authCallbackRedirect, confirmedEmail, sameOriginRedirect, validAccountPassword } from "../lib/account-auth";

test("an anonymous project only gets a password after its email is verified", () => {
  assert.equal(confirmedEmail({ email: "owner@example.com", is_anonymous: true, email_confirmed_at: "2026-11-06" }, "owner@example.com"), false);
  assert.equal(confirmedEmail({ email: "owner@example.com", is_anonymous: false }, "owner@example.com"), false);
  assert.equal(confirmedEmail({ email: "owner@example.com", is_anonymous: false, email_confirmed_at: "2026-11-06" }, "OWNER@example.com"), true);
  assert.equal(validAccountPassword("short"), false);
  assert.equal(validAccountPassword("safe-passphrase-2026"), true);
});

test("email callbacks cannot redirect the user off the Studio domain", () => {
  const origin = "https://studio.segmenta.online";
  assert.equal(sameOriginRedirect(origin, "/?access=reset").href, `${origin}/?access=reset`);
  assert.equal(sameOriginRedirect(origin, "https://evil.example/collect").href, `${origin}/`);
  assert.equal(sameOriginRedirect(origin, "//evil.example/collect").href, `${origin}/`);
  assert.equal(sameOriginRedirect(origin, "https://[").href, `${origin}/`);
});

test("old account setup and recovery emails reach the current password form", () => {
  const origin = "https://studio.segmenta.online";
  for (const access of ["setup", "reset"]) {
    assert.equal(authCallbackRedirect(origin, `/?access=${access}`).href, `${origin}/login?reset=1`);
    assert.equal(authCallbackRedirect(origin, `${origin}/?access=${access}&unrelated=value#fragment`).href, `${origin}/login?reset=1`);
  }
  assert.equal(authCallbackRedirect(origin, "/login?reset=1").href, `${origin}/login?reset=1`);
  assert.equal(authCallbackRedirect(origin, "/?access=1").href, `${origin}/?access=1`);
  assert.equal(authCallbackRedirect(origin, "/projects?access=setup").href, `${origin}/projects?access=setup`);
});

test("legacy recovery normalization cannot turn an external URL into a recovery link", () => {
  const origin = "https://studio.segmenta.online";
  for (const destination of ["https://evil.example/?access=reset", "//evil.example/?access=setup", "https://studio.segmenta.online@evil.example/?access=reset", "javascript:alert(1)", "https://["]) {
    assert.equal(authCallbackRedirect(origin, destination).href, `${origin}/`);
  }
});

test("login distinguishes credentials, confirmation and temporary provider failures without exposing raw errors", () => {
  const secret = "private-provider-debug-details";
  const invalid = accountAuthErrorMessage({ code: "invalid_credentials", status: 400, message: secret });
  const unconfirmed = accountAuthErrorMessage({ code: "email_not_confirmed", status: 400, message: secret });
  assert.match(invalid, /no coinciden/);
  assert.match(unconfirmed, /Confirma tu correo/);
  assert.notEqual(invalid, unconfirmed);
  for (const error of [{ status: 429 }, { code: "over_email_send_rate_limit" }, { code: "over_request_rate_limit" }]) {
    assert.match(accountAuthErrorMessage(error), /demasiados intentos/);
  }
  for (const error of [{ name: "AuthRetryableFetchError" }, { code: "request_timeout" }, { status: 503 }, new TypeError(secret)]) {
    assert.match(accountAuthErrorMessage(error), /conectar/);
  }
  for (const code of ["email_provider_disabled", "signup_disabled", "provider_disabled", "email_address_not_authorized"]) {
    assert.match(accountAuthErrorMessage({ code, message: secret }), /no está disponible/);
  }
  for (const error of [null, undefined, secret, new Error(secret), { code: "unknown", message: secret }, { status: 401, message: secret }]) {
    assert.equal(accountAuthErrorMessage(error), "No pudimos completar el acceso. Inténtalo de nuevo.");
  }
  assert.ok(!invalid.includes(secret) && !unconfirmed.includes(secret));
});
