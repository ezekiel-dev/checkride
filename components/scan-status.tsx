"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type ScanMode, stepStates, stepsForMode } from "@/lib/scanner/steps";
import { cn } from "@/lib/utils";

type ScanState =
  | {
      kind: "ok";
      id: string;
      status: string;
      step: string | null;
      mode?: ScanMode | null;
      createdAt?: string | null;
    }
  | { kind: "not_found" };

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `T+${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function ScanStatus({ scanId }: { scanId: string }) {
  const { data, isPending, isError } = useQuery<ScanState>({
    queryKey: ["scan", scanId],
    queryFn: async () => {
      const response = await fetch(`/api/scans/${scanId}`, { cache: "no-store" });
      if (response.status === 404) {
        return { kind: "not_found" };
      }
      if (!response.ok) {
        throw new Error("scan_fetch_failed");
      }
      const body = (await response.json()) as {
        id: string;
        status: string;
        step: string | null;
        mode?: ScanMode | null;
        createdAt?: string | null;
      };
      return { kind: "ok", ...body };
    },
    refetchInterval: (query) => {
      const state = query.state.data;
      if (!state) {
        return 2000;
      }
      if (state.kind === "not_found") {
        return false;
      }
      return state.status === "completed" || state.status === "failed" ? false : 2000;
    },
    retry: 2,
  });

  const scan = data?.kind === "ok" ? data : null;
  const isActive = scan?.status === "queued" || scan?.status === "running";

  // Elapsed time comes from the server's createdAt, so a page reload does not reset it.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!isActive) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isActive]);

  const startedAt = scan?.createdAt ? Date.parse(scan.createdAt) : Number.NaN;
  const elapsedSeconds =
    now !== null && Number.isFinite(startedAt)
      ? Math.max(0, Math.floor((now - startedAt) / 1000))
      : 0;

  if (isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <span className="sr-only">Loading scan status</span>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-6 w-96" />
        <div className="mt-6 flex flex-col gap-3">
          {stepsForMode().map((step) => (
            <Skeleton key={step.id} className="h-8 w-full max-w-md" />
          ))}
        </div>
      </div>
    );
  }

  // Only show the error screen when there is nothing to display; a failed refetch
  // keeps showing the last known state.
  if (isError && !data) {
    return (
      <section>
        <h1 className="font-display text-3xl tracking-tight text-ink">Scan status</h1>
        <p className="mt-4 text-ink-muted">
          We couldn't load this scan right now. Check your connection and refresh the page.
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/">Back to start</Link>
        </Button>
      </section>
    );
  }

  if (!data || data.kind === "not_found") {
    return (
      <section>
        <h1 className="font-display text-3xl tracking-tight text-ink">Scan not found</h1>
        <p className="mt-4 max-w-[52ch] text-ink-muted">
          We couldn't find a scan with that link. It may have expired, or the link is incomplete.
        </p>
        <Button asChild className="mt-6">
          <Link href="/">Run a new pre-flight</Link>
        </Button>
      </section>
    );
  }

  if (scan?.status === "failed") {
    return (
      <section>
        <h1 className="font-display text-3xl tracking-tight text-ink">Scan didn't finish</h1>
        <p className="mt-4 max-w-[52ch] text-ink-muted">
          Something went wrong while scanning. Nothing was changed on your site or repo — you can
          try again.
        </p>
        <Button asChild className="mt-6">
          <Link href="/">Try again</Link>
        </Button>
      </section>
    );
  }

  if (scan?.status === "completed") {
    return (
      <section>
        <h1 className="font-display text-3xl tracking-tight text-ink">Scan complete</h1>
        <p className="mt-4 max-w-[52ch] text-ink-muted">
          Scan complete (no checks yet). Findings and scoring arrive in a later phase.
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/">Run another scan</Link>
        </Button>
      </section>
    );
  }

  const steps = stepsForMode(scan?.mode);
  const states = stepStates(steps, {
    status: scan?.status ?? "queued",
    step: scan?.step ?? null,
  });
  const activeIndex = Math.max(0, states.indexOf("active"));
  const announcement = `Pre-flight in progress. Step ${activeIndex + 1} of ${steps.length}: ${steps[activeIndex]?.label}.`;

  return (
    <section>
      <p className="font-mono text-xs tracking-[0.2em] text-ink-muted uppercase">Pre-flight</p>
      <h1 className="mt-2 font-display text-3xl tracking-tight text-ink">Running your scan</h1>

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <ol className="mt-8 flex max-w-md flex-col gap-1">
        {steps.map((step, index) => {
          const state = states[index];
          const done = state === "done";
          const current = state === "active";
          const failed = state === "failed";
          return (
            <li
              key={step.id}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-[6px] px-2 py-1.5",
                current && "bg-[var(--surface)]",
              )}
              aria-current={current ? "step" : undefined}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border",
                  done
                    ? "border-[var(--pass)] bg-[var(--pass)] text-[var(--bg)]"
                    : failed
                      ? "border-[var(--critical)] text-[var(--critical)]"
                      : current
                        ? "border-[var(--ink)]"
                        : "border-[var(--border)]",
                )}
                aria-hidden="true"
              >
                {done ? (
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                ) : failed ? (
                  <X className="h-4 w-4" strokeWidth={2.5} />
                ) : current ? (
                  <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
                ) : null}
              </span>
              <span
                className={cn(
                  "text-sm",
                  done || current ? "text-[var(--ink)]" : "text-[var(--ink-muted)]",
                  current && "font-medium",
                )}
              >
                {step.label}
                {current ? <span className="sr-only"> (in progress)</span> : null}
                {done ? <span className="sr-only"> (done)</span> : null}
                {failed ? <span className="sr-only"> (failed)</span> : null}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="mt-6 font-mono text-sm text-ink-muted" aria-hidden="true">
        {formatElapsed(elapsedSeconds)}
      </p>
    </section>
  );
}
