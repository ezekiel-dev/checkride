import { describe, expect, it } from "vitest";
import { runChecks } from "@/lib/scanner/runner";
import type { Check, RawFinding, ScanContext } from "@/lib/scanner/types";
import { makeContext } from "../helpers/snapshot";

function finding(checkId: string, title: string): RawFinding {
  return {
    checkId,
    severity: "medium",
    confidence: "high",
    title,
    evidence: "evidence",
  };
}

const ctx: ScanContext = makeContext();

describe("runChecks", () => {
  it("runs checks in parallel and flattens findings with category attached", async () => {
    const order: string[] = [];
    const slow: Check = {
      id: "slow.check",
      category: "performance",
      target: "site",
      run: () =>
        new Promise((resolve) =>
          setTimeout(() => {
            order.push("slow");
            resolve([finding("slow.check", "slow done")]);
          }, 30),
        ),
    };
    const fast: Check = {
      id: "fast.check",
      category: "security",
      target: "site",
      run: async () => {
        order.push("fast");
        return [finding("fast.check", "fast done")];
      },
    };

    const started = Date.now();
    const results = await runChecks([slow, fast], ctx);
    const elapsed = Date.now() - started;

    // Parallel: total time ≈ slow check, not slow + fast.
    expect(elapsed).toBeLessThan(200);
    expect(order[0]).toBe("fast");
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.category).sort()).toEqual(["performance", "security"]);
    expect(results.every((r) => r.finding.checkId === r.checkId)).toBe(true);
  });

  it("isolates a thrown error as a check_errored info finding", async () => {
    const bad: Check = {
      id: "bad.check",
      category: "secrets",
      target: "site",
      run: () => Promise.reject(new Error("boom")),
    };
    const good: Check = {
      id: "good.check",
      category: "security",
      target: "site",
      run: async () => [finding("good.check", "ok")],
    };

    const results = await runChecks([bad, good], ctx);
    expect(results).toHaveLength(2);

    const errored = results.find((r) => r.checkId === "bad.check");
    expect(errored?.category).toBe("secrets");
    expect(errored?.finding).toMatchObject({
      severity: "info",
      confidence: "high",
      title: "A check could not complete",
      evidence: "check_errored",
    });
    expect(results.find((r) => r.checkId === "good.check")?.finding.title).toBe("ok");
  });

  it("times out a hanging check and still returns other results", async () => {
    const hang: Check = {
      id: "hang.check",
      category: "reliability",
      target: "site",
      run: () => new Promise(() => {}),
    };
    const ok: Check = {
      id: "ok.check",
      category: "security",
      target: "site",
      run: async () => [finding("ok.check", "still ran")],
    };

    const results = await runChecks([hang, ok], ctx, { perCheckTimeoutMs: 50 });
    const errored = results.find((r) => r.checkId === "hang.check");
    expect(errored?.finding.evidence).toBe("check_errored");
    expect(results.find((r) => r.checkId === "ok.check")?.finding.title).toBe("still ran");
  });
});
