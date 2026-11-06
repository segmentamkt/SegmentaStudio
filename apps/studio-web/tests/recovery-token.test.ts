import assert from "node:assert/strict";
import test from "node:test";
import { createRecoveryToken, validRecoveryToken } from "../lib/recovery-token";

test("recovery token is bound to one user and expires", () => {
  const owner = "b96c31fe-49ec-4400-acec-6f5795c4dcb7";
  const other = "05ac2921-f26d-4562-a023-af5cc3376d46";
  const now = 1_793_989_000_000;
  const token = createRecoveryToken(owner, "test-only-secret", now);
  assert.equal(validRecoveryToken(token, owner, "test-only-secret", now + 1000), true);
  assert.equal(validRecoveryToken(token, other, "test-only-secret", now + 1000), false);
  assert.equal(validRecoveryToken(token, owner, "wrong-secret", now + 1000), false);
  assert.equal(validRecoveryToken(token, owner, "test-only-secret", now + 600_001), false);
  assert.equal(validRecoveryToken(`${token}A`, owner, "test-only-secret", now + 1000), false);
});
