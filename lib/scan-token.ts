import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Anonymous scan access tokens. The raw token lives only in the httpOnly
 * `anon_token` cookie; the database stores its SHA-256 hex digest.
 */

export const ANON_TOKEN_COOKIE = "anon_token";
export const ANON_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function generateAnonToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashAnonToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison of two SHA-256 hex digests. */
export function anonTokenHashEquals(a: string, b: string): boolean {
  if (a === "" || b === "") {
    return false;
  }
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
