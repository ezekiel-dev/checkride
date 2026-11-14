import type { SafeFetchResult } from "@/lib/scanner/safe-fetch";
import type { Fetcher } from "@/lib/scanner/types";

/** Build a successful SafeFetchResult for snapshot tests. */
export function okResult(
  url: string,
  body: string,
  options: {
    status?: number;
    headers?: Record<string, string>;
    truncated?: boolean;
    finalUrl?: string;
  } = {},
): SafeFetchResult {
  return {
    ok: true,
    status: options.status ?? 200,
    headers: options.headers ?? {},
    finalUrl: options.finalUrl ?? url,
    body: Buffer.from(body, "utf8"),
    truncated: options.truncated ?? false,
  };
}

/** A fetcher that serves `routes` (pathname -> result) and records requests. */
export function stubFetcher(routes: Record<string, SafeFetchResult | string>): {
  fetcher: Fetcher;
  requested: string[];
} {
  const requested: string[] = [];
  const fetcher: Fetcher = async (url) => {
    requested.push(url);
    const path = new URL(url).pathname;
    const hit = routes[path] ?? routes["*"];
    if (hit === undefined) {
      return { ok: false, reason: "network_error", message: "no route" };
    }
    return typeof hit === "string" ? okResult(url, hit) : hit;
  };
  return { fetcher, requested };
}
