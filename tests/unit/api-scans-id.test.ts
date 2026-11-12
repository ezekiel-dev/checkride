import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashAnonToken } from "@/lib/scan-token";

const SCAN_ID = "11111111-2222-3333-4444-555555555555";
const OWNER_TOKEN = "owner-token-abc";
const OTHER_TOKEN = "other-token-xyz";

const mocks = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  dbError: null as Error | null,
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (mocks.dbError) {
              throw mocks.dbError;
            }
            return mocks.rows;
          },
        }),
      }),
    }),
  }),
}));

import { GET } from "@/app/api/scans/[id]/route";

function makeScanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SCAN_ID,
    status: "running",
    step: "mark-running",
    siteUrl: "https://example.com",
    repoUrl: null,
    anonTokenHash: hashAnonToken(OWNER_TOKEN),
    createdAt: new Date("2026-01-02T03:04:05.000Z"),
    completedAt: null,
    ...overrides,
  };
}

async function callGet(id: string, token?: string) {
  const { NextRequest } = await import("next/server");
  const headers: Record<string, string> = {};
  if (token !== undefined) {
    headers.cookie = `anon_token=${token}`;
  }
  const request = new NextRequest(`http://localhost/api/scans/${id}`, { headers });
  return GET(request, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  mocks.rows.length = 0;
  mocks.dbError = null;
});

describe("GET /api/scans/[id]", () => {
  it("returns an identical 404 for an invalid UUID", async () => {
    const response = await callGet("not-a-uuid", OWNER_TOKEN);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Not found." });
  });

  it("returns an identical 404 when the cookie is missing", async () => {
    mocks.rows.push(makeScanRow());
    const response = await callGet(SCAN_ID);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found." });
  });

  it("returns an identical 404 body for unknown scan and wrong owner", async () => {
    const unknown = await callGet(SCAN_ID, OWNER_TOKEN);
    expect(unknown.status).toBe(404);
    const unknownBody = await unknown.json();

    mocks.rows.push(makeScanRow());
    const wrongOwner = await callGet(SCAN_ID, OTHER_TOKEN);
    expect(wrongOwner.status).toBe(404);
    expect(await wrongOwner.json()).toEqual(unknownBody);
  });

  it("returns the scan shape for the cookie owner, without URLs or hashes", async () => {
    mocks.rows.push(makeScanRow());
    const response = await callGet(SCAN_ID, OWNER_TOKEN);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ["id", "status", "step", "mode", "createdAt", "completedAt"].sort(),
    );
    expect(body).toMatchObject({
      id: SCAN_ID,
      status: "running",
      step: "mark-running",
      mode: "site",
      createdAt: "2026-01-02T03:04:05.000Z",
      completedAt: null,
    });
    expect(body).not.toHaveProperty("siteUrl");
    expect(body).not.toHaveProperty("repoUrl");
    expect(body).not.toHaveProperty("anonTokenHash");
    expect(body).not.toHaveProperty("error");
  });

  it.each([
    [{ siteUrl: "https://example.com", repoUrl: null }, "site"],
    [{ siteUrl: null, repoUrl: "https://github.com/o/r" }, "repo"],
    [{ siteUrl: "https://example.com", repoUrl: "https://github.com/o/r" }, "both"],
    [{ siteUrl: null, repoUrl: null }, null],
  ])("derives mode %s from stored URLs", async (urls, expected) => {
    mocks.rows.push(makeScanRow(urls));
    const response = await callGet(SCAN_ID, OWNER_TOKEN);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { mode: unknown }).mode).toBe(expected);
  });

  it("returns a generic 500 when the database fails", async () => {
    mocks.dbError = new Error("connection string leaked: postgres://user:pw@host/db");
    const response = await callGet(SCAN_ID, OWNER_TOKEN);
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error?: string };
    expect(typeof body.error).toBe("string");
    expect(JSON.stringify(body)).not.toContain("postgres://");
    expect(JSON.stringify(body)).not.toContain("pw@");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
