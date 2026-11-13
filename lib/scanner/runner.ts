import type { Check, RawFinding, ScanContext, ScanFinding } from "@/lib/scanner/types";

export type CheckResult = {
  checkId: string;
  category: Check["category"];
  finding: RawFinding;
};

export type RunnerOptions = {
  perCheckTimeoutMs?: number;
};

const DEFAULT_PER_CHECK_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("check_timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function erroredFinding(check: Check): RawFinding {
  return {
    checkId: check.id,
    severity: "info",
    confidence: "high",
    title: "A check could not complete",
    evidence: "check_errored",
  };
}

/**
 * Run checks in parallel, each isolated by its own timeout. A check that throws
 * or times out becomes a single `check_errored` info finding — the runner never
 * throws and one bad check cannot fail the scan.
 */
export async function runChecks(
  checks: readonly Check[],
  ctx: ScanContext,
  options: RunnerOptions = {},
): Promise<CheckResult[]> {
  const perCheckTimeoutMs = options.perCheckTimeoutMs ?? DEFAULT_PER_CHECK_TIMEOUT_MS;

  const perCheck = await Promise.all(
    checks.map(async (check): Promise<CheckResult[]> => {
      try {
        const findings = await withTimeout(check.run(ctx), perCheckTimeoutMs);
        return findings.map((finding) => ({
          checkId: check.id,
          category: check.category,
          finding: { ...finding, checkId: check.id },
        }));
      } catch {
        return [
          {
            checkId: check.id,
            category: check.category,
            finding: erroredFinding(check),
          },
        ];
      }
    }),
  );

  return perCheck.flat();
}

/** Flatten runner results into persistable findings (category attached). */
export function toScanFindings(results: readonly CheckResult[]): ScanFinding[] {
  return results.map((result) => ({
    ...result.finding,
    category: result.category,
  }));
}
