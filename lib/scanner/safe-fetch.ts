/**
 * SSRF-safe HTTP(S) fetch for user-supplied URLs.
 *
 * export const runtime = "nodejs";
 * This module must never run on the Edge runtime — it uses node:http, node:https,
 * node:dns, and node:net (BlockList). Call it only from Node.js Route Handlers,
 * Server Actions, or Inngest functions.
 *
 * Security model:
 *  - Every URL (and every redirect hop) goes through validateTargetUrl.
 *  - DNS is resolved once per hop; EVERY returned address is checked with isBlockedIp.
 *  - The connection uses a pinned lookup that returns only the address that was
 *    checked, so DNS rebinding cannot swap the IP between check and connect.
 *  - Test-only options (lookup, checkIp, connectPort, appUrl) are ignored unless
 *    NODE_ENV === "test", and limits (timeout, size, redirects) can only be lowered.
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
  // Reserved: oversized bodies are currently reported via `truncated: true`.
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
  /** Can only LOWER the 10s default. */
  timeoutMs?: number;
  /** Can only LOWER the 5 MB default. */
  maxBytes?: number;
  /** Can only LOWER the default of 3. */
  maxRedirects?: number;
  /** Test-only: ignored unless NODE_ENV === "test". */
  appUrl?: string;
  /**
   * Test-only: injectable DNS lookup. Ignored unless NODE_ENV === "test".
   * Every address returned is checked with isBlockedIp before connect.
   */
  lookup?: LookupFunction;
  /**
   * Test-only: injectable IP block predicate. Ignored unless NODE_ENV === "test".
   */
  checkIp?: (ip: string) => boolean;
  /**
   * Test-only: TCP port to connect to after URL validation. Ignored unless
   * NODE_ENV === "test". Lets fixtures listen on an ephemeral port while the
   * validated URL stays on 80/443.
   */
  connectPort?: number;
  signal?: AbortSignal;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type AddressEntry = { address: string; family: number };

type RequestOutcome =
  | {
      kind: "response";
      status: number;
      headers: http.IncomingHttpHeaders;
      body: Buffer;
      truncated: boolean;
    }
  | { kind: "error"; reason: SafeFetchReason; message: string };

/**
 * Decide which options actually take effect.
 * - Production ignores test-only overrides entirely.
 * - Limits can only be lowered below the defaults, never raised.
 * Exported so it can be unit tested without touching the network.
 */
export function resolveEffectiveOptions(options: SafeFetchOptions, nodeEnv: string | undefined) {
  const isTest = nodeEnv === "test";

  const clamp = (value: number | undefined, max: number): number =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(value, max) : max;

  const requestedRedirects = options.maxRedirects;
  const maxRedirects =
    typeof requestedRedirects === "number" &&
    Number.isInteger(requestedRedirects) &&
    requestedRedirects >= 0
      ? Math.min(requestedRedirects, DEFAULT_MAX_REDIRECTS)
      : DEFAULT_MAX_REDIRECTS;

  return {
    timeoutMs: clamp(options.timeoutMs, DEFAULT_TIMEOUT_MS),
    maxBytes: clamp(options.maxBytes, DEFAULT_MAX_BYTES),
    maxRedirects,
    lookupFn: (isTest ? options.lookup : undefined) ?? dns.lookup,
    checkIp: (isTest ? options.checkIp : undefined) ?? isBlockedIp,
    connectPort: isTest ? options.connectPort : undefined,
    appUrl: (isTest ? options.appUrl : undefined) ?? process.env.NEXT_PUBLIC_APP_URL,
  };
}

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

function timeoutError(): SafeFetchError {
  return { ok: false, reason: "timeout", message: "The request timed out." };
}

/** Reject as soon as the signal aborts, so slow DNS cannot outlive the overall timeout. */
function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const onAbort = () => reject(new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
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
  signal: AbortSignal,
): Promise<{ ok: true; pinned: AddressEntry } | SafeFetchError> {
  let addresses: AddressEntry[];
  try {
    addresses = await withAbort(lookupAll(hostname, lookupFn), signal);
  } catch {
    return signal.aborted
      ? timeoutError()
      : { ok: false, reason: "network_error", message: safeNetworkMessage() };
  }

  // Block if ANY returned address is disallowed (defeats mixed public/private answers).
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
): Promise<RequestOutcome> {
  return new Promise((resolve) => {
    if (options.signal.aborted) {
      resolve({ kind: "error", reason: "timeout", message: "The request timed out." });
      return;
    }

    const transport = url.protocol === "https:" ? https : http;
    let settled = false;

    const settle = (result: RequestOutcome) => {
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
        // Never reuse pooled sockets across requests or hops.
        agent: false,
        // Node sets Host from hostname/port. No cookies or auth headers are ever sent.
        headers: {
          Accept: "*/*",
          "Accept-Encoding": "identity",
          "User-Agent": options.userAgent,
          Connection: "close",
        },
        lookup: options.pinnedLookup,
        timeout: options.timeoutMs,
      },
      (response) => {
        const status = response.statusCode ?? 0;

        // Redirect bodies are never needed: drop the connection instead of reading up to 5 MB.
        if (REDIRECT_STATUSES.has(status)) {
          response.destroy();
          settle({
            kind: "response",
            status,
            headers: response.headers,
            body: Buffer.alloc(0),
            truncated: false,
          });
          return;
        }

        void readBody(response, options.maxBytes, options.signal)
          .then(({ body, truncated }) => {
            settle({
              kind: "response",
              status,
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
 * Fetch a URL with SSRF protections: URL validation, DNS IP checks pinned to the
 * connection, manual redirects (max 3), 10s timeout covering DNS and the whole
 * redirect chain, 5 MB streamed body cap, identity encoding only.
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

  const { timeoutMs, maxBytes, maxRedirects, lookupFn, checkIp, connectPort, appUrl } =
    resolveEffectiveOptions(options, process.env.NODE_ENV);
  const userAgent = getUserAgent(appUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timeout);
      return timeoutError();
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
      const pinned = await resolveAndPin(url.hostname, lookupFn, checkIp, controller.signal);
      if (!pinned.ok) {
        return pinned;
      }

      const result = await requestOnce(url, {
        method,
        timeoutMs,
        maxBytes,
        userAgent,
        pinnedLookup: createPinnedLookup(pinned.pinned),
        connectPort,
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

        // Re-validated (scheme, host, port, IP) at the top of the next loop iteration.
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
