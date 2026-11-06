import assert from "node:assert/strict";
import test from "node:test";
import { confirmedEmail, sameOriginRedirect, validAccountPassword } from "../lib/account-auth";

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
});
