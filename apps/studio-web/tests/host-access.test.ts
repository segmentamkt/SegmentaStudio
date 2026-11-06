import assert from "node:assert/strict";
import test from "node:test";
import { isPublicAuthPath, isStudioHost } from "../lib/host-access";

const host = "owner@example.com";

test("only the permanent host account passes the first access filter", () => {
  assert.equal(isStudioHost({ email: "OWNER@example.com", role: "authenticated", is_anonymous: false }, host), true);
  assert.equal(isStudioHost({ email: host, role: "authenticated", is_anonymous: true }, host), false);
  assert.equal(isStudioHost({ email: "other@example.com", role: "authenticated", is_anonymous: false }, host), false);
  assert.equal(isStudioHost({ email: host, role: "anon", is_anonymous: false }, host), false);
  assert.equal(isStudioHost(null, host), false);
  assert.equal(isStudioHost({ email: host, role: "authenticated", is_anonymous: false }, undefined), false);
});

test("login, email callback and PWA shell remain public", () => {
  assert.equal(isPublicAuthPath("/login"), true);
  assert.equal(isPublicAuthPath("/auth/callback"), true);
  assert.equal(isPublicAuthPath("/manifest.webmanifest"), true);
  assert.equal(isPublicAuthPath("/"), false);
  assert.equal(isPublicAuthPath("/api/studio"), false);
  assert.equal(isPublicAuthPath("/api/media/123"), false);
});
