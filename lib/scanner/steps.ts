/**
 * Single source of truth for scan pipeline steps.
 *
 * Imported by BOTH the Inngest function (writes scans.step) and the progress UI
 * (renders the checklist), so the two can never drift apart. This file must stay
 * free of Node-only imports because the client bundle uses it.
 *
 * Add a step here only when the pipeline really runs it (for example "fetch-site"
 * in Phase 2 and "fetch-repo" in Phase 3).
 */

export type ScanMode = "site" | "repo" | "both";

/** Pipeline step ids written to scans.step by the Inngest function. */
export const STEP = {
  validate: "validate-and-resolve",
  running: "mark-running",
  scanSite: "scan-site",
  finalize: "finalize",
} as const;

export type ScanStepDef = {
  /** "queued" is a UI-only step (the scan exists but the pipeline has not started). */
  id: "queued" | (typeof STEP)[keyof typeof STEP];
  label: string;
  appliesTo: "always" | "site" | "repo";
};

export const SCAN_STEPS: readonly ScanStepDef[] = [
  { id: "queued", label: "Queued", appliesTo: "always" },
  { id: STEP.validate, label: "Checking your URLs", appliesTo: "always" },
  { id: STEP.running, label: "Starting the scan", appliesTo: "always" },
  { id: STEP.scanSite, label: "Scanning your site", appliesTo: "site" },
  { id: STEP.finalize, label: "Wrapping up", appliesTo: "always" },
];

/** Steps that apply to a scan mode. Unknown or missing mode shows only "always" steps. */
export function stepsForMode(mode?: ScanMode | null): ScanStepDef[] {
  return SCAN_STEPS.filter((step) => {
    if (step.appliesTo === "always") {
      return true;
    }
    if (mode === "both") {
      return true;
    }
    return step.appliesTo === mode;
  });
}

export type StepState = "done" | "active" | "pending" | "failed";

/**
 * State of every step for a scan.
 * - completed: every step is done, whatever scans.step says.
 * - queued/running: steps before the current one are done, the current one is active.
 * - failed: the step that was active is marked failed (or the first step if unknown).
 */
export function stepStates(
  steps: readonly ScanStepDef[],
  scan: { status: string; step: string | null },
): StepState[] {
  if (steps.length === 0) {
    return [];
  }

  if (scan.status === "completed") {
    return steps.map(() => "done");
  }

  const knownIndex = steps.findIndex((s) => s.id === scan.step);
  const fallback = scan.status === "queued" ? 0 : Math.min(1, steps.length - 1);
  const current = knownIndex >= 0 ? knownIndex : fallback;

  return steps.map((_, index) => {
    if (index < current) {
      return "done";
    }
    if (index === current) {
      return scan.status === "failed" ? "failed" : "active";
    }
    return "pending";
  });
}
