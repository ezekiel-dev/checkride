/**
 * SSRF-safe HTTP(S) fetch for user-supplied URLs.
 *
 * export const runtime = "nodejs";
 * This module must never run on the Edge runtime — it uses node:http, node:https,
 * node:dns, and node:net (BlockList). Call it only from Node.js Route Handlers,
 * Server Actions, or Inngest functions.
 */

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { isBlockedIp, validateTargetUrl } from "@/lib/scanner/url-validation";

export type SafeFetchReason =
  | "blocked_url"
  | "blocked_ip"
  | "too_many_redirects"
  | "timeout"
  | "too_large"
  | "network_error";

export type SafeFetchSuccess = {
  ok: true;
  status: number;
  headers: http.IncomingHttpHeaders;
  finalUrl: string;
  body: Buffer;
  truncated: boolean;
};

export type SafeFetchError = {
  ok: false;
  reason: SafeFetchReason;
  message: string;
};

export type SafeFetchResult = SafeFetchSuccess | SafeFetchError;

export type SafeFetchMethod = "GET" | "HEAD";

export type SafeFetchOptions = {
  method?: SafeFetchMethod;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  appUrl?: string;
  /**
   * Injectable DNS lookup (tests). Production uses dns.lookup.
   * Every address returned is checked with isBlockedIp before connect.
   */
  lookup?: LookupFunction;
  /**
   * Injectable IP block predicate (tests only). Defaults to isBlockedIp.
   */
  checkIp?: (ip: string) => boolean;
  /**
   * Test-only: TCP port to connect to after URL validation.
   * Lets fixtures listen on an ephemeral port while the validated URL stays on 80/443.
   */
  connectPort?: number;
  signal?: AbortSignal;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type AddressEntry = { address: string; family: number };

function getUserAgent(appUrl: string | undefined): string {
  const base =
    appUrl && appUrl.trim() !== ""
      ? appUrl.replace(/\/$/, "")
      : (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `LaunchCheckBot/1.0 (+${base}/bot)`;
}

function safeNetworkMessage(): string {
  return "The request failed due to a network error.";
}

function lookupAll(hostname: string, lookupFn: LookupFunction): Promise<AddressEntry[]> {
  return new Promise((resolve, reject) => {
    // Prefer all:true when the implementation supports it (Node dns.lookup).
    const withAll = lookupFn as (
      hostname: string,
      options: dns.LookupAllOptions,
      callback: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void,
    ) => void;

    try {
      withAll(hostname, { all: true }, (err, addresses) => {
        if (err) {
          reject(err);
          return;
        }
        if (!addresses || addresses.length === 0) {
          reject(new Error("ENOTFOUND"));
          return;
        }
        resolve(addresses.map((entry) => ({ address: entry.address, family: entry.family })));
      });
    } catch {
      // Fallback for simple (hostname, cb) test doubles.
      lookupFn(hostname, { all: false }, (err, address, family) => {
        if (err) {
          reject(err);
          return;
        }
        if (typeof address !== "string") {
          reject(new Error("ENOTFOUND"));
          return;
        }
        resolve([{ address, family: family ?? 4 }]);
      });
    }
  });
}

function createPinnedLookup(pinned: AddressEntry): LookupFunction {
  return ((
    _hostname: string,
    options: dns.LookupOneOptions | dns.LookupAllOptions | number | undefined,
    callback?: (
      err: NodeJS.ErrnoException | null,
      address: string | dns.LookupAddress[],
      family?: number,
    ) => void,
  ) => {
    const cb =
      typeof options === "function"
        ? options
        : (callback as (
            err: NodeJS.ErrnoException | null,
            address: string | dns.LookupAddress[],
            family?: number,
          ) => void);

    const wantsAll =
      typeof options === "object" && options !== null && "all" in options && options.all === true;

    if (wantsAll) {
      cb(null, [{ address: pinned.address, family: pinned.family }]);
      return;
    }

    cb(null, pinned.address, pinned.family);
  }) as LookupFunction;
}

async function resolveAndPin(
  hostname: string,
  lookupFn: LookupFunction,
  checkIp: (ip: string) => boolean,
): Promise<{ ok: true; pinned: AddressEntry } | SafeFetchError> {
  let addresses: AddressEntry[];
  try {
    addresses = await lookupAll(hostname, lookupFn);
  } catch {
    return { ok: false, reason: "network_error", message: safeNetworkMessage() };
  }

  for (const entry of addresses) {
    if (checkIp(entry.address)) {
      return {
        ok: false,
        reason: "blocked_ip",
        message: "The destination address is not allowed.",
      };
    }
  }

  return { ok: true, pinned: addresses[0] };
}

function readBody(
  response: http.IncomingMessage,
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ body: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let truncated = false;
    let settled = false;

    const finish = (body: Buffer, wasTruncated: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve({ body, truncated: wasTruncated });
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const onAbort = () => {
      response.destroy();
      fail(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };

    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      response.off("data", onData);
      response.off("end", onEnd);
      response.off("error", onError);
    };

    const onData = (chunk: Buffer | string) => {
      if (truncated) {
        return;
      }
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = maxBytes - total;
      if (buf.length > remaining) {
        if (remaining > 0) {
          chunks.push(buf.subarray(0, remaining));
          total += remaining;
        }
        truncated = true;
        response.destroy();
        finish(Buffer.concat(chunks, total), true);
        return;
      }
      chunks.push(buf);
      total += buf.length;
    };

    const onEnd = () => {
      finish(Buffer.concat(chunks, total), truncated);
    };

    const onError = (error: Error) => {
      if (truncated && (error.message === "aborted" || error.name === "AbortError")) {
        finish(Buffer.concat(chunks, total), true);
        return;
      }
      fail(error);
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });
    response.on("data", onData);
    response.on("end", onEnd);
    response.on("error", onError);
  });
}

function requestOnce(
  url: URL,
  options: {
    method: SafeFetchMethod;
    timeoutMs: number;
    maxBytes: number;
    userAgent: string;
    pinnedLookup: LookupFunction;
    connectPort?: number;
    signal: AbortSignal;
  },
): Promise<
  | {
      kind: "response";
      status: number;
      headers: http.IncomingHttpHeaders;
      body: Buffer;
      truncated: boolean;
    }
  | { kind: "error"; reason: SafeFetchReason; message: string }
> {
  return new Promise((resolve) => {
    if (options.signal.aborted) {
      resolve({ kind: "error", reason: "timeout", message: "The request timed out." });
      return;
    }

    const transport = url.protocol === "https:" ? https : http;
    let settled = false;

    const settle = (
      result:
        | {
            kind: "response";
            status: number;
            headers: http.IncomingHttpHeaders;
            body: Buffer;
            truncated: boolean;
          }
        | { kind: "error"; reason: SafeFetchReason; message: string },
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      options.signal.removeEventListener("abort", onAbort);
      resolve(result);
    };

    const onAbort = () => {
      req.destroy();
      settle({ kind: "error", reason: "timeout", message: "The request timed out." });
    };

    const defaultPort = url.protocol === "https:" ? 443 : 80;
    const port = options.connectPort ?? (url.port ? Number(url.port) : defaultPort);

    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port,
        path: `${url.pathname}${url.search}`,
        method: options.method,
        headers: {
          Accept: "*/*",
          "Accept-Encoding": "identity",
          "User-Agent": options.userAgent,
          Host: url.host,
          Connection: "close",
        },
        lookup: options.pinnedLookup,
        timeout: options.timeoutMs,
      },
      (response) => {
        // Redirects are handled by the caller; still read/discard body for non-redirects.
        void readBody(response, options.maxBytes, options.signal)
          .then(({ body, truncated }) => {
            settle({
              kind: "response",
              status: response.statusCode ?? 0,
              headers: response.headers,
              body,
              truncated,
            });
          })
          .catch(() => {
            settle({
              kind: "error",
              reason: options.signal.aborted ? "timeout" : "network_error",
              message: options.signal.aborted ? "The request timed out." : safeNetworkMessage(),
            });
          });
      },
    );

    req.on("timeout", () => {
      req.destroy();
      settle({ kind: "error", reason: "timeout", message: "The request timed out." });
    });

    req.on("error", () => {
      settle({
        kind: "error",
        reason: options.signal.aborted ? "timeout" : "network_error",
        message: options.signal.aborted ? "The request timed out." : safeNetworkMessage(),
      });
    });

    options.signal.addEventListener("abort", onAbort, { once: true });
    req.end();
  });
}

/**
 * Fetch a URL with SSRF protections: URL validation, DNS IP checks at connect time,
 * manual redirects (max 3), 10s timeout, 5 MB body cap, identity encoding only.
 */
export async function safeFetch(
  input: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const method = options.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    return {
      ok: false,
      reason: "blocked_url",
      message: "Only GET and HEAD are allowed.",
    };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const lookupFn = options.lookup ?? dns.lookup;
  const checkIp = options.checkIp ?? isBlockedIp;
  const appUrl = options.appUrl ?? process.env.NEXT_PUBLIC_APP_URL;
  const userAgent = getUserAgent(appUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timeout);
      return { ok: false, reason: "timeout", message: "The request timed out." };
    }
    options.signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    let current = input;
    let redirects = 0;

    while (true) {
      const validated = validateTargetUrl(current, { appUrl });
      if (!validated.ok) {
        return {
          ok: false,
          reason: "blocked_url",
          message: validated.message,
        };
      }

      const url = validated.url;
      const pinned = await resolveAndPin(url.hostname, lookupFn, checkIp);
      if (!pinned.ok) {
        return pinned;
      }

      const result = await requestOnce(url, {
        method,
        timeoutMs,
        maxBytes,
        userAgent,
        pinnedLookup: createPinnedLookup(pinned.pinned),
        connectPort: options.connectPort,
        signal: controller.signal,
      });

      if (result.kind === "error") {
        return { ok: false, reason: result.reason, message: result.message };
      }

      if (REDIRECT_STATUSES.has(result.status)) {
        const locationHeader = result.headers.location;
        const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
        if (!location) {
          return {
            ok: false,
            reason: "network_error",
            message: safeNetworkMessage(),
          };
        }

        redirects += 1;
        if (redirects > maxRedirects) {
          return {
            ok: false,
            reason: "too_many_redirects",
            message: "Too many redirects.",
          };
        }

        let nextUrl: URL;
        try {
          nextUrl = new URL(location, url);
        } catch {
          return {
            ok: false,
            reason: "blocked_url",
            message: "The redirect target is not allowed.",
          };
        }

        current = nextUrl.toString();
        continue;
      }

      return {
        ok: true,
        status: result.status,
        headers: result.headers,
        finalUrl: url.toString(),
        body: result.body,
        truncated: result.truncated,
      };
    }
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

export { isBlockedIp, validateTargetUrl } from "@/lib/scanner/url-validation";
