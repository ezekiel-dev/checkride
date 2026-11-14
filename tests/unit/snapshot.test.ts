import { afterEach, describe, expect, it } from "vitest";
import { buildSiteSnapshot } from "@/lib/scanner/snapshot";
import type { Fetcher } from "@/lib/scanner/types";
import { okResult, stubFetcher } from "../helpers/fetcher";
import { type FixtureServer, startFixtureServer } from "../helpers/fixture-server";

let server: FixtureServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const ROBOTS_ALLOW_ALL = "User-agent: *\nAllow: /\n";

function htmlWithScripts(srcs: string[]): string {
  const tags = srcs
    .map((src) =>
      src.endsWith(".js") && !src.includes("modulepreload") ? `<script src="${src}"></script>` : "",
    )
    .join("\n");
  return `<!doctype html><html><head>${tags}</head><body>hi</body></html>`;
}

describe("buildSiteSnapshot", () => {
  it("discovers same-origin scripts and ignores cross-origin ones", async () => {
    server = await startFixtureServer({
      "/": {
        body: `<!doctype html><html><head>
          <script src="/static/a.js"></script>
          <script src="https://cdn.example.com/x.js"></script>
          <link rel="modulepreload" href="/static/b.js" />
        </head><body>hi</body></html>`,
      },
      "/static/a.js": { body: "a();" },
      "/static/b.js": { body: "b();" },
      "/robots.txt": { body: ROBOTS_ALLOW_ALL },
    });

    const result = await buildSiteSnapshot("http://fixture.example/", server.fetcher);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const urls = result.snapshot.scripts.map((s) => s.url);
    expect(urls).toContain("http://fixture.example/static/a.js");
    expect(urls).toContain("http://fixture.example/static/b.js");
    expect(urls).toHaveLength(2);
    expect(urls.some((u) => u.includes("cdn.example.com"))).toBe(false);
    expect(result.snapshot.html).toContain("<script");
    expect(result.snapshot.fetchMs).toBeGreaterThanOrEqual(0);
  });

  it("skips script paths disallowed by robots.txt and records a note", async () => {
    server = await startFixtureServer({
      "/": {
        body: htmlWithScripts(["/ok.js", "/private/secret.js"]),
      },
      "/ok.js": { body: "ok();" },
      "/private/secret.js": { body: "secret();" },
      "/robots.txt": { body: "User-agent: *\nDisallow: /private\n" },
    });

    const result = await buildSiteSnapshot("http://fixture.example/", server.fetcher);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.snapshot.scripts.map((s) => s.url)).toEqual(["http://fixture.example/ok.js"]);
    expect(result.snapshot.notes.some((n) => n.includes("robots.txt"))).toBe(true);
  });

  it("caps discovered scripts at 15", async () => {
    const srcs = Array.from({ length: 20 }, (_, i) => `/s${i}.js`);
    const routes: Record<string, { body: string }> = {
      "/": { body: htmlWithScripts(srcs) },
      "/robots.txt": { body: ROBOTS_ALLOW_ALL },
    };
    for (const src of srcs) {
      routes[src] = { body: "x();" };
    }
    server = await startFixtureServer(routes);

    const result = await buildSiteSnapshot("http://fixture.example/", server.fetcher);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.snapshot.scripts).toHaveLength(15);
    expect(result.snapshot.notes.some((n) => n.includes("15"))).toBe(true);
  });

  it("returns site_unreachable when the home page fetch fails", async () => {
    const { fetcher } = stubFetcher({
      "/": { ok: false, reason: "network_error", message: "boom" },
    });
    const result = await buildSiteSnapshot("https://down.example/", fetcher);
    expect(result).toEqual({ ok: false, reason: "site_unreachable" });
  });

  it("treats an HTTP error status on the home page as unreachable", async () => {
    const { fetcher } = stubFetcher({
      "/": okResult("https://err.example/", "nope", { status: 503 }),
      "/robots.txt": okResult("https://err.example/robots.txt", ""),
    });
    const result = await buildSiteSnapshot("https://err.example/", fetcher);
    expect(result).toEqual({ ok: false, reason: "site_unreachable" });
  });

  it("records htmlTruncated and per-script truncation flags", async () => {
    const { fetcher } = stubFetcher({
      "/": okResult("https://t.example/", "<html></html>", { truncated: true }),
      "/robots.txt": okResult("https://t.example/robots.txt", ROBOTS_ALLOW_ALL),
    });
    const result = await buildSiteSnapshot("https://t.example/", fetcher);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.htmlTruncated).toBe(true);
  });

  it("skips a script whose finalUrl redirected to a different origin", async () => {
    const { fetcher } = stubFetcher({
      "/": `<!doctype html><html><head><script src="/redir.js"></script><script src="/ok.js"></script></head></html>`,
      "/robots.txt": ROBOTS_ALLOW_ALL,
      "/redir.js": okResult("https://site.example/redir.js", "x();", {
        finalUrl: "https://evil.example/stolen.js",
      }),
      "/ok.js": "ok();",
    });

    const result = await buildSiteSnapshot("https://site.example/", fetcher);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.snapshot.scripts.map((s) => s.url)).toEqual(["https://site.example/ok.js"]);
  });

  it("skips script responses with image/audio/video/font content types", async () => {
    server = await startFixtureServer({
      "/": {
        body: `<!doctype html><html><head>
          <script src="/img.js"></script>
          <script src="/font.js"></script>
          <script src="/real.js"></script>
        </head></html>`,
      },
      "/img.js": { headers: { "content-type": "image/png" }, body: "not js" },
      "/font.js": { headers: { "content-type": "font/woff2" }, body: "not js" },
      "/real.js": { headers: { "content-type": "text/javascript" }, body: "real();" },
      "/robots.txt": { body: ROBOTS_ALLOW_ALL },
    });

    const result = await buildSiteSnapshot("http://fixture.example/", server.fetcher);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.snapshot.scripts.map((s) => s.url)).toEqual(["http://fixture.example/real.js"]);
  });

  it("stops fetching scripts once the 25 MB total byte budget is exceeded", async () => {
    const srcs = Array.from({ length: 12 }, (_, i) => `/big${i}.js`);
    const bigBody = "x".repeat(5 * 1024 * 1024); // 5 MB per script
    const routes: Record<string, string> = {
      "/": `<!doctype html><html><head>${srcs.map((s) => `<script src="${s}"></script>`).join("")}</head></html>`,
      "/robots.txt": ROBOTS_ALLOW_ALL,
    };
    for (const src of srcs) {
      routes[src] = bigBody;
    }
    const { fetcher } = stubFetcher(routes);

    const result = await buildSiteSnapshot("https://big.example/", fetcher);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // First batch of 4 fits under 25 MB; the second batch crosses it, so the
    // remaining scripts are skipped with a note.
    expect(result.snapshot.scripts.length).toBeLessThan(12);
    expect(result.snapshot.scripts.length).toBeGreaterThan(0);
    expect(result.snapshot.notes.some((n) => n.includes("25 MB"))).toBe(true);
  });

  it("stops fetching scripts when the deadline is reached", async () => {
    const srcs = Array.from({ length: 8 }, (_, i) => `/d${i}.js`);
    const routes: Record<string, string> = {
      "/": `<!doctype html><html><head>${srcs.map((s) => `<script src="${s}"></script>`).join("")}</head></html>`,
      "/robots.txt": ROBOTS_ALLOW_ALL,
    };
    for (const src of srcs) {
      routes[src] = "x();";
    }
    const { fetcher } = stubFetcher(routes);

    // Each fetch advances the clock by 400ms; deadline is 1000ms, so after the
    // home page + robots.txt (800ms) only part of the first script batch fits.
    let t = 0;
    const now = () => t;
    const timedFetcher: Fetcher = async (url) => {
      t += 400;
      return fetcher(url);
    };

    const result = await buildSiteSnapshot("https://deadline.example/", timedFetcher, {
      deadlineMs: 1000,
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.snapshot.scripts.length).toBeLessThan(8);
    expect(result.snapshot.notes.some((n) => n.includes("budget"))).toBe(true);
  });
});
