import type { SiteSnapshot } from "@/lib/scanner/types";

/** Minimal valid SiteSnapshot for check tests; override what you need. */
export function makeSnapshot(overrides: Partial<SiteSnapshot> = {}): SiteSnapshot {
  return {
    requestedUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    status: 200,
    headers: {},
    html: "<html><body>fixture</body></html>",
    htmlTruncated: false,
    fetchMs: 120,
    scripts: [],
    notes: [],
    ...overrides,
  };
}

export function makeContext(overrides: Partial<SiteSnapshot> = {}) {
  return {
    snapshot: makeSnapshot(overrides),
    fetch: async () => {
      throw new Error("fetch not expected in this test");
    },
  };
}
