import { afterEach, describe, expect, it } from "vitest";
import { runSiteScan } from "@/lib/scanner/scan-site";
import type { Fetcher } from "@/lib/scanner/types";
import { cleanSite } from "../../fixtures/sites/clean-site";
import { vulnerableSite } from "../../fixtures/sites/vulnerable-site";
import { okResult, stubFetcher } from "../helpers/fetcher";
import { type FixtureServer, startFixtureServer } from "../helpers/fixture-server";

let server: FixtureServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const SITE_HTML = `<!doctype html><html><head><script src="/app.js"></script></head><body>hi</body></html>`;

/** Stub fetcher whose home page reports an HTTPS finalUrl. */
function httpsSiteFetcher(options: { hsts?: string } = {}): Fetcher {
  const { fetcher } = stubFetcher({
    "/": okResult("https://vuln.example/", SITE_HTML, {
      headers: options.hsts ? { "strict-transport-security": options.hsts } : {},
    }),
    "/app.js": "console.log(1);",
    "/robots.txt": "User-agent: *\nAllow: /\n",
  });
  return fetcher;
}

describe("runSiteScan", () => {
  it("returns site_unreachable when the home page cannot be fetched", async () => {
    const { fetcher } = stubFetcher({
      "/": { ok: false, reason: "timeout", message: "slow" },
    });
    const result = await runSiteScan({ siteUrl: "https://down.example/", fetcher });
    expect(result).toEqual({ ok: false, reason: "site_unreachable" });
  });

  it("produces an HSTS finding for a vulnerable HTTPS site", async () => {
    const result = await runSiteScan({
      siteUrl: "https://vuln.example/",
      fetcher: httpsSiteFetcher(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hsts = result.findings.find((f) => f.checkId === "site.headers.hsts");
    expect(hsts).toMatchObject({ severity: "medium", confidence: "high", category: "security" });
  });

  it("produces no findings for a clean HTTPS site", async () => {
    const result = await runSiteScan({
      siteUrl: "https://vuln.example/",
      fetcher: httpsSiteFetcher({ hsts: "max-age=31536000; includeSubDomains" }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.findings).toEqual([]);
  });

  it("converts snapshot notes into info findings", async () => {
    const { fetcher } = stubFetcher({
      "/": okResult("https://notes.example/", SITE_HTML),
      "/app.js": { ok: false, reason: "network_error", message: "gone" },
      "/robots.txt": "User-agent: *\nAllow: /\n",
    });
    const result = await runSiteScan({ siteUrl: "https://notes.example/", fetcher });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const note = result.findings.find((f) => f.checkId === "site.snapshot.notes");
    expect(note).toMatchObject({ severity: "info", category: "reliability" });
    // The failed script fetch also means no HSTS header -> hsts finding exists too.
    expect(result.findings.some((f) => f.checkId === "site.headers.hsts")).toBe(true);
  });

  it("runs end-to-end against the local fixture server", async () => {
    server = await startFixtureServer(vulnerableSite);
    const result = await runSiteScan({
      siteUrl: "http://fixture.example/",
      fetcher: server.fetcher,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Plain HTTP => the HSTS check correctly self-skips; findings may be empty.
    expect(result.findings.every((f) => f.severity === "info")).toBe(true);
  });

  it("clean fixture produces no non-info findings", async () => {
    server = await startFixtureServer(cleanSite);
    const result = await runSiteScan({
      siteUrl: "http://fixture.example/",
      fetcher: server.fetcher,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.findings.filter((f) => f.severity !== "info")).toEqual([]);
  });
});
