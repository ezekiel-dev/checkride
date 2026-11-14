import type { IncomingHttpHeaders } from "node:http";
import type { SafeFetchResult } from "@/lib/scanner/safe-fetch";

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Confidence = "high" | "medium" | "low";
export type Category = "security" | "secrets" | "performance" | "reliability";

/** A raw finding. `evidence` must already be redacted before it gets here. */
export type RawFinding = {
  checkId: string;
  severity: Severity;
  title: string;
  evidence: string;
  location?: string;
  confidence: Confidence;
};

/** A finding with its check's category attached (runner output). */
export type ScanFinding = RawFinding & { category: Category };

/** Injected fetcher: production uses safeFetch; tests use fixture servers. */
export type Fetcher = (url: string) => Promise<SafeFetchResult>;

export type SiteScript = {
  url: string;
  body: string;
  truncated: boolean;
};

export type SiteSnapshot = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  headers: IncomingHttpHeaders;
  html: string;
  htmlTruncated: boolean;
  /** Wall-clock time of the home page fetch, in milliseconds. */
  fetchMs: number;
  scripts: SiteScript[];
  /** Human-readable notes about skipped fetches and budget exhaustion. */
  notes: string[];
};

export type ScanContext = {
  snapshot: SiteSnapshot;
  fetch: Fetcher;
};

export type Check = {
  id: string;
  category: Category;
  target: "site" | "repo";
  run(ctx: ScanContext): Promise<RawFinding[]>;
};
