import type { RawFinding, Severity } from "@/lib/scanner/types";

/** Ordered most-severe first. Index is the severity rank (lower = worse). */
export const SEVERITIES: readonly Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
] as const;

export function severityRank(severity: Severity): number {
  return SEVERITIES.indexOf(severity);
}

export function countBySeverity(
  findings: readonly Pick<RawFinding, "severity">[],
): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}
