import { eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "@/lib/db/schema";
import { severityRank } from "@/lib/scanner/severity";
import type { ScanFinding, Severity } from "@/lib/scanner/types";

const { findings } = schema;

export type Db = NeonHttpDatabase<typeof schema>;

const MAX_EVIDENCE_LENGTH = 500;
const MAX_TITLE_LENGTH = 200;
const MAX_LOCATION_LENGTH = 300;
const TOP_FINDINGS_LIMIT = 3;

export type FindingSummary = {
  counts: Record<Severity, number>;
  topFindings: { severity: Severity; title: string }[];
};

/**
 * Location is stored as origin + pathname only (no query string or fragment,
 * which can carry tokens). Non-URL locations fall back to a plain truncation.
 */
function sanitizeLocation(location: string | undefined): string | null {
  if (!location) {
    return null;
  }
  try {
    const url = new URL(location);
    return `${url.origin}${url.pathname}`;
  } catch {
    return location.slice(0, MAX_LOCATION_LENGTH);
  }
}

/**
 * Idempotently replace a scan's findings in ONE batched request: the delete is
 * scoped to this scan_id and the insert only runs when there are rows. Safe to
 * retry — a retried step never produces duplicates.
 */
export async function persistFindings(
  db: Db,
  scanId: string,
  scanFindings: readonly ScanFinding[],
): Promise<void> {
  const rows = scanFindings.map((finding) => ({
    scanId,
    checkId: finding.checkId,
    category: finding.category,
    severity: finding.severity,
    confidence: finding.confidence,
    title: finding.title.slice(0, MAX_TITLE_LENGTH),
    evidenceRedacted: finding.evidence.slice(0, MAX_EVIDENCE_LENGTH),
    location: sanitizeLocation(finding.location),
  }));

  const deleteQuery = db.delete(findings).where(eq(findings.scanId, scanId));
  if (rows.length > 0) {
    await db.batch([deleteQuery, db.insert(findings).values(rows)]);
  } else {
    await db.batch([deleteQuery]);
  }
}

/** Severity counts plus up to 3 highest-severity non-info finding titles. */
export async function getFindingSummary(db: Db, scanId: string): Promise<FindingSummary> {
  const rows = await db
    .select({ severity: findings.severity, title: findings.title })
    .from(findings)
    .where(eq(findings.scanId, scanId));

  const counts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const row of rows) {
    counts[row.severity] += 1;
  }

  const topFindings = rows
    .filter((row) => row.severity !== "info")
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .slice(0, TOP_FINDINGS_LIMIT)
    .map((row) => ({ severity: row.severity, title: row.title }));

  return { counts, topFindings };
}
