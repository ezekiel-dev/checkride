import type { Check, RawFinding, ScanContext } from "@/lib/scanner/types";

const MIN_MAX_AGE = 15_768_000; // 6 months, in seconds

function headerValue(ctx: ScanContext, name: string): string | undefined {
  const value = ctx.snapshot.headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function maxAgeSeconds(value: string): number | null {
  const match = /max-age\s*=\s*(\d+)/i.exec(value);
  return match ? Number.parseInt(match[1], 10) : null;
}

/**
 * site.headers.hsts — flags a missing or weak Strict-Transport-Security header.
 * Skipped entirely for non-HTTPS final URLs (HSTS is meaningless there).
 */
export const hstsCheck: Check = {
  id: "site.headers.hsts",
  category: "security",
  target: "site",
  async run(ctx: ScanContext): Promise<RawFinding[]> {
    const { finalUrl } = ctx.snapshot;
    if (!finalUrl.startsWith("https://")) {
      return [];
    }

    const value = headerValue(ctx, "strict-transport-security");
    const location = finalUrl;

    if (value === undefined) {
      return [
        {
          checkId: this.id,
          severity: "medium",
          confidence: "high",
          title: "Missing Strict-Transport-Security header",
          evidence: "header not present",
          location,
        },
      ];
    }

    const maxAge = maxAgeSeconds(value);
    if (maxAge === null || maxAge < MIN_MAX_AGE) {
      return [
        {
          checkId: this.id,
          severity: "low",
          confidence: "high",
          title: "Weak Strict-Transport-Security header",
          evidence: value.slice(0, 300),
          location,
        },
      ];
    }

    return [];
  },
};
