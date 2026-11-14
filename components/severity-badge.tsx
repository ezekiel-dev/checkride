import { CircleAlert, CircleMinus, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import type { Severity } from "@/lib/scanner/types";
import { cn } from "@/lib/utils";

const SEVERITY_META: Record<Severity, { label: string; icon: typeof Info; className: string }> = {
  critical: {
    label: "Critical",
    icon: OctagonAlert,
    className: "border-[var(--critical)] text-[var(--critical)]",
  },
  high: {
    label: "High",
    icon: TriangleAlert,
    className: "border-[var(--high)] text-[var(--high)]",
  },
  medium: {
    label: "Medium",
    icon: CircleAlert,
    className: "border-[var(--medium)] text-[var(--medium)]",
  },
  low: {
    label: "Low",
    icon: Info,
    className: "border-[var(--low)] text-[var(--low)]",
  },
  info: {
    label: "Info",
    icon: CircleMinus,
    className: "border-[var(--info)] text-[var(--info)]",
  },
};

/**
 * Severity badge: icon + text label + severity color. Never relies on color
 * alone — the text label and icon always convey the severity too.
 */
export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const meta = SEVERITY_META[severity];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[4px] border bg-[var(--surface)] px-2 py-0.5 text-xs font-medium",
        meta.className,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {meta.label}
    </span>
  );
}
