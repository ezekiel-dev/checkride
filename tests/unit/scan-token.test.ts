import { describe, expect, it } from "vitest";
import { anonTokenHashEquals, generateAnonToken, hashAnonToken } from "@/lib/scan-token";

describe("generateAnonToken", () => {
  it("produces unique 43-character url-safe tokens", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const token = generateAnonToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      tokens.add(token);
    }
    expect(tokens.size).toBe(100);
  });
});

describe("hashAnonToken", () => {
  it("produces a deterministic 64-char hex digest that does not contain the token", () => {
    const token = generateAnonToken();
    const hash = hashAnonToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAnonToken(token)).toBe(hash);
    expect(hash).not.toContain(token);
    expect(hashAnonToken("different-token")).not.toBe(hash);
  });
});

describe("anonTokenHashEquals", () => {
  const hashA = hashAnonToken("token-a");
  const hashB = hashAnonToken("token-b");

  it("returns true for identical hashes", () => {
    expect(anonTokenHashEquals(hashA, hashA)).toBe(true);
    expect(anonTokenHashEquals(hashA, hashAnonToken("token-a"))).toBe(true);
  });

  it("returns false for different hashes without throwing", () => {
    expect(anonTokenHashEquals(hashA, hashB)).toBe(false);
    expect(anonTokenHashEquals(hashB, hashA)).toBe(false);
  });

  it("returns false for different lengths and empty strings", () => {
    expect(anonTokenHashEquals(hashA, hashA.slice(0, 32))).toBe(false);
    expect(anonTokenHashEquals("", hashA)).toBe(false);
    expect(anonTokenHashEquals(hashA, "")).toBe(false);
    expect(anonTokenHashEquals("", "")).toBe(false);
  });
});
