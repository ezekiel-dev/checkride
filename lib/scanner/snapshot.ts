import { isAllowed, parseRobots } from "@/lib/scanner/robots";
import type { Fetcher, SiteScript, SiteSnapshot } from "@/lib/scanner/types";

const USER_AGENT = "LaunchCheckBot";
const MAX_SCRIPTS = 15;
const SCRIPT_CONCURRENCY = 4;
const DEFAULT_DEADLINE_MS = 25_000;

export type SnapshotOptions = {
  deadlineMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
};

export type SnapshotResult =
  | { ok: true; snapshot: SiteSnapshot }
  | { ok: false; reason: "site_unreachable" };

const SCRIPT_SRC_RE = /<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
const LINK_TAG_RE = /<link\b[^>]*>/gi;
const MODULEPRELOAD_RE = /\brel\s*=\s*["'][^"']*modulepreload[^"']*["']/i;
const HREF_RE = /\bhref\s*=\s*["']([^"']+)["']/i;

function extractScriptUrls(html: string, finalUrl: string): string[] {
  const origin = new URL(finalUrl).origin;
  const found = new Set<string>();

  for (const match of html.matchAll(SCRIPT_SRC_RE)) {
    found.add(match[1]);
  }
  for (const match of html.matchAll(LINK_TAG_RE)) {
    const tag = match[0];
    if (!MODULEPRELOAD_RE.test(tag)) {
      continue;
    }
    const href = HREF_RE.exec(tag);
    if (href) {
      found.add(href[1]);
    }
  }

  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const raw of found) {
    let url: URL;
    try {
      url = new URL(raw, finalUrl);
    } catch {
      continue;
    }
    if (url.origin !== origin) {
      continue;
    }
    const normalized = url.toString();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      resolved.push(normalized);
    }
  }
  return resolved;
}

/**
 * Build a SiteSnapshot through the injected fetcher under the Phase 2 budgets:
 * one home page fetch, one robots.txt fetch, at most 15 same-origin scripts at
 * concurrency 4, all inside `deadlineMs`. Never throws.
 */
export async function buildSiteSnapshot(
  siteUrl: string,
  fetcher: Fetcher,
  options: SnapshotOptions = {},
): Promise<SnapshotResult> {
  const now = options.now ?? Date.now;
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const deadline = now() + deadlineMs;
  const notes: string[] = [];

  try {
    const started = now();
    const home = await fetcher(siteUrl);
    const fetchMs = Math.max(0, now() - started);

    if (!home.ok || home.status >= 400) {
      return { ok: false, reason: "site_unreachable" };
    }

    const snapshotBase = {
      requestedUrl: siteUrl,
      finalUrl: home.finalUrl,
      status: home.status,
      headers: home.headers,
      html: home.body.toString("utf8"),
      htmlTruncated: home.truncated,
      fetchMs,
    };

    // robots.txt: one fetch; any failure means allow everything.
    let robots = parseRobots("");
    try {
      const robotsUrl = new URL("/robots.txt", home.finalUrl).toString();
      const robotsRes = await fetcher(robotsUrl);
      if (robotsRes.ok && robotsRes.status < 400) {
        robots = parseRobots(robotsRes.body.toString("utf8"));
      }
    } catch {
      // Missing or unreadable robots.txt => allow all.
    }

    const discovered = extractScriptUrls(snapshotBase.html, home.finalUrl);
    const allowed: string[] = [];
    const disallowed: string[] = [];
    for (const url of discovered) {
      const path = new URL(url).pathname;
      if (isAllowed(robots, USER_AGENT, path)) {
        allowed.push(url);
      } else {
        disallowed.push(url);
      }
    }
    if (disallowed.length > 0) {
      notes.push(
        `Skipped ${disallowed.length} script file(s) disallowed by robots.txt for ${USER_AGENT}.`,
      );
    }

    const queued = allowed.slice(0, MAX_SCRIPTS);
    if (allowed.length > MAX_SCRIPTS) {
      notes.push(
        `Skipped ${allowed.length - MAX_SCRIPTS} additional script file(s) (limit of ${MAX_SCRIPTS}).`,
      );
    }

    const scripts: SiteScript[] = [];
    let fetchFailures = 0;
    let index = 0;

    const worker = async () => {
      while (index < queued.length) {
        if (now() >= deadline) {
          return;
        }
        const url = queued[index];
        index += 1;
        try {
          const res = await fetcher(url);
          if (res.ok) {
            scripts.push({
              url,
              body: res.body.toString("utf8"),
              truncated: res.truncated,
            });
          } else {
            fetchFailures += 1;
          }
        } catch {
          fetchFailures += 1;
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(SCRIPT_CONCURRENCY, queued.length) }, () => worker()),
    );

    // Keep discovery order regardless of which worker finished first.
    scripts.sort((a, b) => queued.indexOf(a.url) - queued.indexOf(b.url));

    // `index` counts every fetch actually attempted; anything left over was
    // skipped because the deadline hit mid-batch.
    const deadlineSkipped = queued.length - index;
    if (deadlineSkipped > 0) {
      notes.push(
        `Skipped ${deadlineSkipped} script file(s): the ${Math.round(deadlineMs / 1000)}s scan budget was reached.`,
      );
    }
    if (fetchFailures > 0) {
      notes.push(`Skipped ${fetchFailures} script file(s) that could not be fetched.`);
    }

    return {
      ok: true,
      snapshot: { ...snapshotBase, scripts, notes },
    };
  } catch {
    return { ok: false, reason: "site_unreachable" };
  }
}
