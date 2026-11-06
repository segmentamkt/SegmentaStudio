import { createHmac, timingSafeEqual } from "node:crypto";

const TEN_MINUTES = 10 * 60 * 1000;

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createRecoveryToken(userId: string, secret: string, now = Date.now()) {
  if (!secret || !/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Recovery configuration unavailable");
  const payload = `${userId}.${now + TEN_MINUTES}`;
  return `${payload}.${signature(payload, secret)}`;
}

export function validRecoveryToken(token: string | undefined, userId: string, secret: string | undefined, now = Date.now()) {
  if (!token || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== userId) return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + TEN_MINUTES) return false;
  const expected = Buffer.from(signature(`${parts[0]}.${parts[1]}`, secret));
  const actual = Buffer.from(parts[2]);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
