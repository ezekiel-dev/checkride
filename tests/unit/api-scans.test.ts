import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SCAN_ID = "11111111-2222-3333-4444-555555555555";

const mocks = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
  inngestSend: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        mocks.inserted.push(values);
        return { returning: async () => [{ id: SCAN_ID }] };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mocks.updated.push(values);
        return { where: async () => undefined };
      },
    }),
  }),
}));

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: mocks.inngestSend },
}));

import { POST } from "@/app/api/scans/route";

const VALID_BODY = {
  mode: "site",
  siteUrl: "https://example.com",
  repoUrl: "",
  acceptedOwnership: true,
};

function makeRequest(body: unknown, ip: string) {
  return new Request("http://localhost/api/scans", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function setCookieHeader(response: Response): string {
  return response.headers.get("set-cookie") ?? "";
}

beforeEach(() => {
  mocks.inserted.length = 0;
  mocks.updated.length = 0;
  mocks.inngestSend.mockReset();
  mocks.inngestSend.mockResolvedValue({ ids: ["evt_1"] });
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
});

describe("POST /api/scans", () => {
  it("creates a scan, sets a hashed anon cookie, and sends the Inngest event", async () => {
    const response = await POST(makeRequest(VALID_BODY, "203.0.113.50"));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: SCAN_ID });

    expect(mocks.inngestSend).toHaveBeenCalledWith({
      name: "scan/requested",
      data: { scanId: SCAN_ID },
    });

    expect(mocks.inserted).toHaveLength(1);
    const row = mocks.inserted[0];
    expect(row.siteUrl).toBe("https://example.com");
    expect(row.repoUrl).toBeNull();
    expect(row.status).toBe("queued");

    const cookie = setCookieHeader(response);
    expect(cookie).toContain("anon_token=");
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");

    const tokenMatch = /anon_token=([^;]+)/.exec(cookie);
    expect(tokenMatch).not.toBeNull();
    const rawToken = tokenMatch?.[1] ?? "";
    const expectedHash = createHash("sha256").update(decodeURIComponent(rawToken)).digest("hex");

    // Only the SHA-256 hash is stored; the raw token never touches the DB row.
    expect(row.anonTokenHash).toBe(expectedHash);
    expect(JSON.stringify(row)).not.toContain(rawToken);
  });

  it("rejects a malformed JSON body", async () => {
    const response = await POST(makeRequest("{not json", "203.0.113.51"));
    expect(response.status).toBe(400);
    expect(mocks.inserted).toHaveLength(0);
  });

  it("rejects an invalid body without echoing input", async () => {
    const response = await POST(
      makeRequest({ ...VALID_BODY, siteUrl: "http://localhost:3000" }, "203.0.113.52"),
    );
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toContain("localhost");
    expect(mocks.inserted).toHaveLength(0);
  });

  it("rejects missing ownership confirmation", async () => {
    const response = await POST(
      makeRequest({ ...VALID_BODY, acceptedOwnership: false }, "203.0.113.53"),
    );
    expect(response.status).toBe(400);
    expect(mocks.inserted).toHaveLength(0);
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it("rate limits the fourth scan from the same IP", async () => {
    const ip = "203.0.113.60";
    for (let i = 0; i < 3; i++) {
      const ok = await POST(makeRequest(VALID_BODY, ip));
      expect(ok.status).toBe(201);
    }
    const blocked = await POST(makeRequest(VALID_BODY, ip));
    expect(blocked.status).toBe(429);
    expect(mocks.inserted).toHaveLength(3);
  });

  it("returns 500 and marks the scan failed when Inngest send fails", async () => {
    mocks.inngestSend.mockRejectedValueOnce(new Error("inngest down"));
    const response = await POST(makeRequest(VALID_BODY, "203.0.113.70"));
    expect(response.status).toBe(500);
    expect(mocks.updated[0]).toMatchObject({ status: "failed" });
  });
});
