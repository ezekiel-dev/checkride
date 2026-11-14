import { eq } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { scans } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest/client";
import { productionFetcher } from "@/lib/scanner/fetcher";
import { persistFindings } from "@/lib/scanner/persist";
import { runSiteScan } from "@/lib/scanner/scan-site";
import { STEP } from "@/lib/scanner/steps";
import { validateTargetUrl } from "@/lib/scanner/url-validation";
import { repoUrlField } from "@/lib/scanner/validation";

const scanRequestedEvent = z.object({
  name: z.literal("scan/requested"),
  data: z.object({ scanId: z.string().uuid() }),
});

type Db = ReturnType<typeof getDb>;

async function setScanStep(db: Db, scanId: string, step: string | null) {
  await db.update(scans).set({ step }).where(eq(scans.id, scanId));
}

async function markScanFailed(db: Db, scanId: string) {
  await db
    .update(scans)
    .set({ status: "failed", error: "Scan failed unexpectedly. Please try again." })
    .where(eq(scans.id, scanId));
}

/**
 * scan.run — current pipeline (Phase 2A):
 *   validate-and-resolve → mark-running → scan-site (site scans only) → finalize
 *
 * scan-site builds the site snapshot, runs the registered site checks, and
 * idempotently replaces this scan's findings rows inside ONE step, returning
 * only { findingCount } so step output stays small. Repo checks land in
 * Phase 3; scoring/AI in Phase 4.
 *
 * Failure handling:
 * - Transient errors are retried by Inngest (2 retries). We do NOT mark the
 *   scan failed on the first error, because the UI treats "failed" as final.
 * - Permanent problems (bad payload, missing scan, invalid stored URL,
 *   unreachable site) throw NonRetriableError so they fail immediately.
 * - onFailure runs once, after the final failure, and marks the scan failed.
 *   The scans.step value is kept so the UI can show which step failed.
 */
export const scanRun = inngest.createFunction(
  {
    id: "scan.run",
    retries: 2,
    triggers: [{ event: "scan/requested" }],
    onFailure: async ({ event, step }) => {
      // The failed function's original event is nested inside the failure event.
      const original = scanRequestedEvent.safeParse((event.data as { event?: unknown }).event);
      if (!original.success) {
        return;
      }
      const { scanId } = original.data.data;
      await step.run("mark-scan-failed", async () => {
        await markScanFailed(getDb(), scanId);
      });
    },
  },
  async ({ event, step }) => {
    const parsedEvent = scanRequestedEvent.safeParse(event);
    if (!parsedEvent.success) {
      throw new NonRetriableError("Invalid scan/requested event payload.");
    }
    const { scanId } = parsedEvent.data.data;
    const db = getDb();

    const resolved = await step.run(STEP.validate, async () => {
      await setScanStep(db, scanId, STEP.validate);

      const [scan] = await db
        .select({ siteUrl: scans.siteUrl, repoUrl: scans.repoUrl })
        .from(scans)
        .where(eq(scans.id, scanId))
        .limit(1);

      if (!scan || (!scan.siteUrl && !scan.repoUrl)) {
        throw new NonRetriableError("scan_not_found");
      }

      // Re-validate stored URLs. DNS resolution happens inside safeFetch
      // later, so it is intentionally not duplicated here.
      if (scan.siteUrl) {
        const site = validateTargetUrl(scan.siteUrl);
        if (!site.ok) {
          throw new NonRetriableError("invalid_site_url");
        }
      }
      if (scan.repoUrl && !repoUrlField.safeParse(scan.repoUrl).success) {
        throw new NonRetriableError("invalid_repo_url");
      }

      return { siteUrl: scan.siteUrl, repoUrl: scan.repoUrl };
    });

    await step.run(STEP.running, async () => {
      await setScanStep(db, scanId, STEP.running);
      await db.update(scans).set({ status: "running" }).where(eq(scans.id, scanId));
    });

    // Site scans only: snapshot, check, and persist inside ONE step so the
    // step output stays small (never return the snapshot or bundle bodies).
    const siteUrl = resolved.siteUrl;
    if (siteUrl) {
      await step.run(STEP.scanSite, async () => {
        await setScanStep(db, scanId, STEP.scanSite);
        const result = await runSiteScan({
          siteUrl,
          fetcher: productionFetcher,
        });
        if (!result.ok) {
          throw new NonRetriableError("site_unreachable");
        }
        await persistFindings(db, scanId, result.findings);
        return { findingCount: result.findings.length };
      });
    }

    await step.run(STEP.finalize, async () => {
      await setScanStep(db, scanId, STEP.finalize);
      await db
        .update(scans)
        .set({ status: "completed", step: null, completedAt: new Date() })
        .where(eq(scans.id, scanId));
    });

    return { ok: true, scanId };
  },
);
