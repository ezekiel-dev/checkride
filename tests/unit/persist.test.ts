import { describe, expect, it } from "vitest";
import { findings } from "@/lib/db/schema";
import { type Db, getFindingSummary, persistFindings } from "@/lib/scanner/persist";
import type { ScanFinding, Severity } from "@/lib/scanner/types";

function finding(overrides: Partial<ScanFinding> = {}): ScanFinding {
  return {
    checkId: "site.headers.hsts",
    category: "security",
    severity: "medium",
    confidence: "high",
    title: "Missing Strict-Transport-Security header",
    evidence: "header not present",
    ...overrides,
  };
}

type MockDb = {
  db: Db;
  calls: string[];
  /** Queries passed to each db.batch() call. */
  batches: unknown[][];
  insertedRows: Record<string, unknown>[][];
};

function mockDb(findingRows: { severity: Severity; title: string }[] = []): MockDb {
  const calls: string[] = [];
  const batches: unknown[][] = [];
  const insertedRows: Record<string, unknown>[][] = [];
  const db = {
    delete: () => ({
      where: () => {
        calls.push("delete");
        return { kind: "delete" };
      },
    }),
    insert: () => ({
      values: (rows: Record<string, unknown>[]) => {
        calls.push("insert");
        insertedRows.push(rows);
        return { kind: "insert", rows };
      },
    }),
    batch: async (queries: unknown[]) => {
      calls.push("batch");
      batches.push(queries);
    },
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          if (table === findings) {
            return findingRows;
          }
          throw new Error("unexpected select");
        },
      }),
    }),
  };
  return { db: db as unknown as Db, calls, batches, insertedRows };
}

describe("persistFindings", () => {
  it("issues one batch containing the scoped delete and the insert", async () => {
    const { db, batches, insertedRows } = mockDb();
    await persistFindings(db, "scan-1", [finding(), finding({ checkId: "other.check" })]);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(batches[0][0]).toMatchObject({ kind: "delete" });
    expect(batches[0][1]).toMatchObject({ kind: "insert" });
    expect((batches[0][1] as { rows: unknown[] }).rows).toEqual(insertedRows[0]);
    expect(insertedRows[0]).toHaveLength(2);
    expect(insertedRows[0][0]).toMatchObject({
      scanId: "scan-1",
      checkId: "site.headers.hsts",
      category: "security",
      severity: "medium",
      confidence: "high",
      evidenceRedacted: "header not present",
      location: null,
    });
  });

  it("batches only the delete when there are no findings", async () => {
    const { db, batches, calls } = mockDb();
    await persistFindings(db, "scan-1", []);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
    expect(batches[0][0]).toMatchObject({ kind: "delete" });
    expect(calls).not.toContain("insert");
  });

  it("stays idempotent across retries (each call is one delete+insert batch)", async () => {
    const { db, batches } = mockDb();
    await persistFindings(db, "scan-1", [finding()]);
    await persistFindings(db, "scan-1", [finding(), finding({ severity: "low" })]);

    expect(batches).toHaveLength(2);
    for (const batch of batches) {
      expect(batch).toHaveLength(2);
      expect(batch[0]).toMatchObject({ kind: "delete" });
      expect(batch[1]).toMatchObject({ kind: "insert" });
    }
  });

  it("truncates title to 200 chars and evidence to 500", async () => {
    const { db, insertedRows } = mockDb();
    await persistFindings(db, "scan-1", [
      finding({ title: "t".repeat(300), evidence: "x".repeat(600) }),
    ]);
    const row = insertedRows[0][0];
    expect((row.title as string).length).toBe(200);
    expect((row.evidenceRedacted as string).length).toBe(500);
  });

  it("stores location as origin + pathname, dropping query and fragment", async () => {
    const { db, insertedRows } = mockDb();
    await persistFindings(db, "scan-1", [
      finding({ location: "https://example.com/some/path?token=abc#section" }),
    ]);
    expect(insertedRows[0][0].location).toBe("https://example.com/some/path");
  });

  it("truncates non-URL locations to 300 chars", async () => {
    const { db, insertedRows } = mockDb();
    await persistFindings(db, "scan-1", [finding({ location: `not a url ${"y".repeat(400)}` })]);
    const location = insertedRows[0][0].location as string;
    expect(location.length).toBe(300);
    expect(location).not.toContain("?");
  });
});

describe("getFindingSummary", () => {
  it("counts by severity and returns top non-info findings, highest first", async () => {
    const { db } = mockDb([
      { severity: "info", title: "note" },
      { severity: "low", title: "low one" },
      { severity: "critical", title: "critical one" },
      { severity: "high", title: "high one" },
      { severity: "medium", title: "medium one" },
      { severity: "high", title: "high two" },
    ]);

    const summary = await getFindingSummary(db, "scan-1");
    expect(summary.counts).toEqual({
      critical: 1,
      high: 2,
      medium: 1,
      low: 1,
      info: 1,
    });
    expect(summary.topFindings).toEqual([
      { severity: "critical", title: "critical one" },
      { severity: "high", title: "high one" },
      { severity: "high", title: "high two" },
    ]);
  });

  it("returns zero counts and no top findings for an empty scan", async () => {
    const { db } = mockDb();
    const summary = await getFindingSummary(db, "scan-1");
    expect(summary.counts).toEqual({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });
    expect(summary.topFindings).toEqual([]);
  });
});
