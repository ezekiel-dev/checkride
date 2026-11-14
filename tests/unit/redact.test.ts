import { describe, expect, it } from "vitest";
import { redactSecret } from "@/lib/scanner/redact";

describe("redactSecret", () => {
  it("keeps the first 4 and last 2 characters and masks the middle", () => {
    const secret = "sk_live_abcdefghijklmnop";
    const redacted = redactSecret(secret);
    expect(redacted.startsWith("sk_l")).toBe(true);
    expect(redacted.endsWith("op")).toBe(true);
    expect(redacted).toContain("*");
    // The middle of the secret must never appear.
    expect(redacted).not.toContain("efgh");
    expect(redacted).not.toContain("ijkl");
    expect(redacted.length).toBe(secret.length);
  });

  it("fully masks values shorter than 12 characters", () => {
    expect(redactSecret("short")).toBe("*****");
    expect(redactSecret("12345678901")).toBe("*".repeat(11));
    expect(redactSecret("123456789012")).toBe("1234******12");
  });

  it("handles the empty string", () => {
    expect(redactSecret("")).toBe("");
  });

  it("counts unicode code points, not UTF-16 units", () => {
    const secret = "🔑abcdef123456🔑"; // 14 code points
    const redacted = redactSecret(secret);
    expect(redacted.startsWith("🔑abc")).toBe(true);
    expect(redacted.endsWith("6🔑")).toBe(true);
    expect(redacted).not.toContain("def1");
    expect(Array.from(redacted)).toHaveLength(14);
  });
});
