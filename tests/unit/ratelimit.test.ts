import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANON_SCAN_LIMIT,
  checkScanRateLimits,
  DOMAIN_SCAN_LIMIT,
  getClientIp,
  InMemorySlidingWindow,
} from "@/lib/ratelimit";

// Never let a local .env with real Upstash credentials leak into these tests.
beforeEach(() => {
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("InMemorySlidingWindow", () => {
  it("allows up to the limit then blocks", async () => {
    const window = new InMemorySlidingWindow(3, 60_000);
    const now = 1_000_000;
    expect((await window.check("k", now)).success).toBe(true);
    expect((await window.check("k", now + 1)).success).toBe(true);
    expect((await window.check("k", now + 2)).success).toBe(true);
    const blocked = await window.check("k", now + 3);
    expect(blocked.success).toBe(false);
    expect(blocked.reset).toBe(now + 60_000);
  });

  it("frees capacity after the window passes", async () => {
    const window = new InMemorySlidingWindow(2, 1_000);
    await window.check("k", 0);
    await window.check("k", 100);
    expect((await window.check("k", 200)).success).toBe(false);
    // First hit (t=0) has expired by t=1001; second (t=100) still counts.
    expect((await window.check("k", 1001)).success).toBe(true);
    expect((await window.check("k", 1002)).success).toBe(false);
  });

  it("tracks keys independently", async () => {
    const window = new InMemorySlidingWindow(1, 1_000);
    expect((await window.check("a", 0)).success).toBe(true);
    expect((await window.check("b", 0)).success).toBe(true);
    expect((await window.check("a", 1)).success).toBe(false);
  });
});

describe("checkScanRateLimits (in-memory, non-production)", () => {
  it("allows ANON_SCAN_LIMIT scans per IP then returns 429", async () => {
    const ip = "203.0.113.10";
    for (let i = 0; i < ANON_SCAN_LIMIT; i++) {
      const result = await checkScanRateLimits({ ip, domain: `site-${i}.example.com` });
      expect(result.allowed).toBe(true);
    }
    const blocked = await checkScanRateLimits({ ip, domain: "site-x.example.com" });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.status).toBe(429);
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("enforces the per-domain limit across different IPs", async () => {
    const domain = "popular-app.example.com";
    for (let i = 0; i < DOMAIN_SCAN_LIMIT; i++) {
      const result = await checkScanRateLimits({ ip: `198.51.100.${i + 1}`, domain });
      expect(result.allowed).toBe(true);
    }
    const blocked = await checkScanRateLimits({ ip: "198.51.100.99", domain });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.status).toBe(429);
    }
  });

  it("still applies the IP limit when no domain is given", async () => {
    const ip = "192.0.2.77";
    for (let i = 0; i < ANON_SCAN_LIMIT; i++) {
      await checkScanRateLimits({ ip, domain: null });
    }
    const blocked = await checkScanRateLimits({ ip, domain: null });
    expect(blocked.allowed).toBe(false);
  });
});

describe("checkScanRateLimits (production without Upstash)", () => {
  it("fails closed with 503", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    const result = await checkScanRateLimits({ ip: "203.0.113.1", domain: null });
    expect(result).toEqual({ allowed: false, status: 503 });
  });
});

describe("getClientIp", () => {
  it("uses the first x-forwarded-for value", () => {
    const headers = new Headers({ "x-forwarded-for": " 1.2.3.4 , 5.6.7.8" });
    expect(getClientIp(headers)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip then unknown", () => {
    expect(getClientIp(new Headers({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(getClientIp(new Headers())).toBe("unknown");
    expect(getClientIp(new Headers({ "x-forwarded-for": " , " }))).toBe("unknown");
  });
});
