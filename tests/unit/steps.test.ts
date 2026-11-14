import { describe, expect, it } from "vitest";
import { SCAN_STEPS, STEP, stepStates, stepsForMode } from "@/lib/scanner/steps";

const SITE_STEP_IDS = ["queued", STEP.validate, STEP.running, STEP.scanSite, STEP.finalize];
const ALWAYS_STEP_IDS = ["queued", STEP.validate, STEP.running, STEP.finalize];

describe("stepsForMode", () => {
  it("returns the site scan steps for site and both modes", () => {
    expect(stepsForMode("site").map((s) => s.id)).toEqual(SITE_STEP_IDS);
    expect(stepsForMode("both").map((s) => s.id)).toEqual(SITE_STEP_IDS);
  });

  it("returns only the always steps for repo scans", () => {
    expect(stepsForMode("repo").map((s) => s.id)).toEqual(ALWAYS_STEP_IDS);
  });

  it("returns only the always steps when the mode is missing", () => {
    for (const mode of [null, undefined] as const) {
      expect(stepsForMode(mode).map((s) => s.id)).toEqual(ALWAYS_STEP_IDS);
    }
  });

  it("never lists repo or bundle steps for a site scan (regression)", () => {
    const labels = stepsForMode("site").map((s) => s.label.toLowerCase());
    expect(labels.some((l) => l.includes("repo"))).toBe(false);
    expect(labels.some((l) => l.includes("bundle"))).toBe(false);
  });

  it("filters mode-specific steps when they exist (allowed counterpart)", () => {
    const defs = [
      { id: "queued", label: "Queued", appliesTo: "always" },
      { id: STEP.validate, label: "Site only", appliesTo: "site" },
      { id: STEP.running, label: "Repo only", appliesTo: "repo" },
    ] as const;
    const pick = (mode: "site" | "repo" | "both" | null) =>
      defs
        .filter((s) => s.appliesTo === "always" || mode === "both" || s.appliesTo === mode)
        .map((s) => s.label);
    expect(pick("site")).toEqual(["Queued", "Site only"]);
    expect(pick("repo")).toEqual(["Queued", "Repo only"]);
    expect(pick("both")).toEqual(["Queued", "Site only", "Repo only"]);
  });
});

describe("stepStates", () => {
  const steps = stepsForMode("site");

  it("marks only the first step active when queued with no step yet", () => {
    expect(stepStates(steps, { status: "queued", step: null })).toEqual([
      "active",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("follows scans.step while the scan is still queued", () => {
    expect(stepStates(steps, { status: "queued", step: STEP.validate })).toEqual([
      "done",
      "active",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("marks earlier steps done and the current step active while running", () => {
    expect(stepStates(steps, { status: "running", step: STEP.running })).toEqual([
      "done",
      "done",
      "active",
      "pending",
      "pending",
    ]);
    expect(stepStates(steps, { status: "running", step: STEP.scanSite })).toEqual([
      "done",
      "done",
      "done",
      "active",
      "pending",
    ]);
    expect(stepStates(steps, { status: "running", step: STEP.finalize })).toEqual([
      "done",
      "done",
      "done",
      "done",
      "active",
    ]);
  });

  it("falls back safely when the step value is unknown", () => {
    const states = stepStates(steps, { status: "running", step: "something-else" });
    expect(states.filter((s) => s === "active")).toHaveLength(1);
  });

  it("marks every step done when completed, whatever scans.step says", () => {
    for (const step of [null, STEP.validate, "garbage"]) {
      expect(stepStates(steps, { status: "completed", step })).toEqual([
        "done",
        "done",
        "done",
        "done",
        "done",
      ]);
    }
  });

  it("marks the step that was active as failed when the scan failed", () => {
    expect(stepStates(steps, { status: "failed", step: STEP.scanSite })).toEqual([
      "done",
      "done",
      "done",
      "failed",
      "pending",
    ]);
  });

  it("handles an empty step list", () => {
    expect(stepStates([], { status: "running", step: null })).toEqual([]);
  });

  it("keeps SCAN_STEPS and stepsForMode in sync", () => {
    expect(SCAN_STEPS.length).toBe(stepsForMode("both").length);
  });
});
