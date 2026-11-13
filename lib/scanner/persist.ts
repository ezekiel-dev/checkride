import { eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "@/lib/db/schema";
import { severityRank } from "@/lib/scanner/severity";
import type { ScanFinding, Severity } from "@/lib/scanner/types";

const { findings } = schema;

export type Db = NeonHttpDatabase<typeof schema>;

const MAX_EVIDENCE_LENGTH = 500;
const MAX_LOCATION_LENGTH = 300;
const TOP_FINDINGS_LIMIT = 3;

export type FindingSummary = {
  counts: Record<Severity, number>;
  topFindings: { severity: Severity; title: string }[];
};

type TransactionCapable = {
  transaction?: (fn: (tx: Db) => Promise<void>) => Promise<void>;
};

async function replaceFindings(db: Db, scanId: string, rows: (typeof findings.$inferInsert)[]) {
  const work = async (target: Db) => {
    await target.delete(findings).where(eq(findings.scanId, scanId));
    if (rows.length > 0) {
      await target.insert(findings).values(rows);
    }
  };

  const maybeTx = db as unknown as TransactionCapable;
  if (typeof maybeTx.transaction === "function") {
    try {
      await maybeTx.transaction((tx) => work(tx));
      return;
    } catch (error) {
      // neon-http exposes transaction() but always throws "No transactions
      // support"; fall back to sequential delete+insert, which is idempotent.
      if (!(error instanceof Error && error.message.includes("No transactions support"))) {
        throw error;
      }
    }
  }
  await work(db);
}

/**
 * Idempotently replace a scan's findings: delete existing rows, then insert.
 * Safe to retry — a retried step never produces duplicates.
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
    title: finding.title,
    evidenceRedacted: finding.evidence.slice(0, MAX_EVIDENCE_LENGTH),
    location: finding.location ? finding.location.slice(0, MAX_LOCATION_LENGTH) : null,
  }));

  await replaceFindings(db, scanId, rows);
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
