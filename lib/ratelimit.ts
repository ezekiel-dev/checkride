import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Rate limiting for scan creation (SPEC section 7.2):
 *  - 3 scans per hour per IP for anonymous users
 *  - no more than 5 scans per day for the same domain
 *
 * Uses Upstash Redis sliding windows when configured. In non-production
 * environments a simple in-memory sliding window is used instead; in
 * production a missing Upstash configuration fails closed (503).
 */

export const ANON_SCAN_LIMIT = 3;
export const ANON_SCAN_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const DOMAIN_SCAN_LIMIT = 5;
export const DOMAIN_SCAN_WINDOW_MS = 24 * 60 * 60 * 1000; // 1 day

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; status: 429 | 503; retryAfterSeconds?: number };

type WindowChecker = (key: string) => Promise<{ success: boolean; reset: number }>;

function upstashWindow(
  limit: number,
  window: `${number} ${"ms" | "s" | "m" | "h" | "d"}`,
): WindowChecker {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL as string,
    token: process.env.UPSTASH_REDIS_REST_TOKEN as string,
  });
  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, window),
    prefix: "launchcheck",
  });
  return async (key) => {
    const result = await ratelimit.limit(key);
    return { success: result.success, reset: result.reset };
  };
}

/** In-memory sliding window: Map<key, timestamps[]> pruned on each check. */
export class InMemorySlidingWindow {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  async check(key: string, now: number = Date.now()): Promise<{ success: boolean; reset: number }> {
    const cutoff = now - this.windowMs;
    const entries = (this.hits.get(key) ?? []).filter((ts) => ts > cutoff);

    if (entries.length >= this.limit) {
      const oldest = entries[0];
      this.hits.set(key, entries);
      return { success: false, reset: oldest + this.windowMs };
    }

    entries.push(now);
    this.hits.set(key, entries);
    return { success: true, reset: now + this.windowMs };
  }

  /** Test helper: drop all recorded hits. */
  reset(): void {
    this.hits.clear();
  }
}

const memoryIpWindow = new InMemorySlidingWindow(ANON_SCAN_LIMIT, ANON_SCAN_WINDOW_MS);
const memoryDomainWindow = new InMemorySlidingWindow(DOMAIN_SCAN_LIMIT, DOMAIN_SCAN_WINDOW_MS);

let upstashIpWindow: WindowChecker | null = null;
let upstashDomainWindow: WindowChecker | null = null;

function getWindows(): { ip: WindowChecker; domain: WindowChecker } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    upstashIpWindow ??= upstashWindow(ANON_SCAN_LIMIT, "1 h");
    upstashDomainWindow ??= upstashWindow(DOMAIN_SCAN_LIMIT, "1 d");
    return { ip: upstashIpWindow, domain: upstashDomainWindow };
  }
  if (process.env.NODE_ENV !== "production") {
    return {
      ip: (key) => memoryIpWindow.check(key),
      domain: (key) => memoryDomainWindow.check(key),
    };
  }
  return null;
}

function retryAfterSeconds(reset: number): number {
  return Math.max(1, Math.ceil((reset - Date.now()) / 1000));
}

/**
 * Check both limits for a scan attempt. `domain` may be null (e.g. only a repo
 * URL was given and it could not be parsed); the per-IP limit still applies.
 */
export async function checkScanRateLimits(input: {
  ip: string;
  domain: string | null;
}): Promise<RateLimitDecision> {
  const windows = getWindows();
  if (!windows) {
    return { allowed: false, status: 503 };
  }

  const ipKey = `ip:${input.ip}`;
  const ipResult = await windows.ip(ipKey);
  if (!ipResult.success) {
    return { allowed: false, status: 429, retryAfterSeconds: retryAfterSeconds(ipResult.reset) };
  }

  if (input.domain) {
    const domainResult = await windows.domain(`domain:${input.domain}`);
    if (!domainResult.success) {
      return {
        allowed: false,
        status: 429,
        retryAfterSeconds: retryAfterSeconds(domainResult.reset),
      };
    }
  }

  return { allowed: true };
}

/** First value of x-forwarded-for, then x-real-ip, then a shared bucket key. */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }
  return "unknown";
}
