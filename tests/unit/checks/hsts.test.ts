import { describe, expect, it } from "vitest";
import { hstsCheck } from "@/lib/scanner/checks/site/hsts";
import { makeContext } from "../../helpers/snapshot";

describe("site.headers.hsts", () => {
  it("returns a medium finding when the header is missing on HTTPS", async () => {
    const findings = await hstsCheck.run(makeContext());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      checkId: "site.headers.hsts",
      severity: "medium",
      confidence: "high",
      evidence: "header not present",
    });
  });

  it("returns a low finding when max-age is below 6 months", async () => {
    const findings = await hstsCheck.run(
      makeContext({ headers: { "strict-transport-security": "max-age=3600" } }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "low",
      confidence: "high",
      evidence: "max-age=3600",
    });
  });

  it("treats a header without max-age as weak", async () => {
    const findings = await hstsCheck.run(
      makeContext({ headers: { "strict-transport-security": "includeSubDomains" } }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("low");
  });

  it("returns nothing for a strong HSTS header", async () => {
    const findings = await hstsCheck.run(
      makeContext({
        headers: {
          "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
        },
      }),
    );
    expect(findings).toEqual([]);
  });

  it("skips non-HTTPS final URLs entirely", async () => {
    const findings = await hstsCheck.run(
      makeContext({
        finalUrl: "http://example.com/",
        requestedUrl: "http://example.com/",
      }),
    );
    expect(findings).toEqual([]);
  });
});
