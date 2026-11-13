import { siteChecks } from "@/lib/scanner/registry";
import { runChecks, toScanFindings } from "@/lib/scanner/runner";
import { buildSiteSnapshot } from "@/lib/scanner/snapshot";
import type { Check, Fetcher, ScanFinding } from "@/lib/scanner/types";

export type SiteScanResult =
  | { ok: true; findings: ScanFinding[] }
  | { ok: false; reason: "site_unreachable" };

export type SiteScanOptions = {
  siteUrl: string;
  fetcher: Fetcher;
  checks?: readonly Check[];
};

/**
 * Snapshot the site once, run all site checks against it, and turn snapshot
 * notes into info findings. Never throws on check failures (runner isolates
 * them); returns site_unreachable only when the home page cannot be fetched.
 */
export async function runSiteScan(options: SiteScanOptions): Promise<SiteScanResult> {
  const built = await buildSiteSnapshot(options.siteUrl, options.fetcher);
  if (!built.ok) {
    return built;
  }

  const ctx = { snapshot: built.snapshot, fetch: options.fetcher };
  const results = await runChecks(options.checks ?? siteChecks, ctx);
  const findings = toScanFindings(results);

  for (const note of built.snapshot.notes) {
    findings.push({
      checkId: "site.snapshot.notes",
      category: "reliability",
      severity: "info",
      confidence: "high",
      title: note,
      evidence: "snapshot_note",
    });
  }

  return { ok: true, findings };
}
