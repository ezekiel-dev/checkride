import { describe, expect, it } from "vitest";
import { scanRequestSchema } from "@/lib/scanner/validation.server";

const validSite = {
  mode: "site",
  siteUrl: "https://example.com",
  repoUrl: "",
  acceptedOwnership: true,
} as const;

const validRepo = {
  mode: "repo",
  siteUrl: "",
  repoUrl: "https://github.com/owner/repo",
  acceptedOwnership: true,
} as const;

describe("scanRequestSchema", () => {
  it("accepts a valid site scan", () => {
    expect(scanRequestSchema.safeParse(validSite).success).toBe(true);
  });

  it("accepts a valid repo scan", () => {
    expect(scanRequestSchema.safeParse(validRepo).success).toBe(true);
  });

  it("accepts repo URLs with .git suffix and trailing slash", () => {
    for (const repoUrl of [
      "https://github.com/owner/repo.git",
      "https://github.com/owner/repo/",
      "https://github.com/my-org/my_repo.name",
    ]) {
      expect(scanRequestSchema.safeParse({ ...validRepo, repoUrl }).success, repoUrl).toBe(true);
    }
  });

  it("accepts mode both with both URLs", () => {
    expect(
      scanRequestSchema.safeParse({
        mode: "both",
        siteUrl: "https://example.com",
        repoUrl: "https://github.com/owner/repo",
        acceptedOwnership: true,
      }).success,
    ).toBe(true);
  });

  it("rejects when the required URL for the mode is missing", () => {
    expect(scanRequestSchema.safeParse({ ...validSite, siteUrl: "" }).success).toBe(false);
    expect(scanRequestSchema.safeParse({ ...validRepo, repoUrl: "" }).success).toBe(false);
    expect(
      scanRequestSchema.safeParse({
        mode: "both",
        siteUrl: "https://example.com",
        repoUrl: "",
        acceptedOwnership: true,
      }).success,
    ).toBe(false);
  });

  it("rejects URLs that do not match the selected mode", () => {
    expect(
      scanRequestSchema.safeParse({
        ...validSite,
        repoUrl: "https://github.com/owner/repo",
      }).success,
    ).toBe(false);
    expect(
      scanRequestSchema.safeParse({
        ...validRepo,
        siteUrl: "https://example.com",
      }).success,
    ).toBe(false);
  });

  it("rejects when acceptedOwnership is not literally true", () => {
    for (const acceptedOwnership of [false, undefined, "true", 1]) {
      expect(
        scanRequestSchema.safeParse({ ...validSite, acceptedOwnership }).success,
        String(acceptedOwnership),
      ).toBe(false);
    }
  });

  it.each([
    "http://localhost",
    "http://localhost:3000",
    "http://127.0.0.1",
    "http://169.254.169.254",
    "http://10.0.0.5",
    "http://[::1]",
    "http://example.com:8080",
    "http://user:pass@example.com",
    "ftp://example.com",
    "file:///etc/passwd",
    "http://foo.local",
    "http://printer.internal",
    "not-a-url",
    "",
  ])("rejects unsafe or invalid site URL: %s", (siteUrl) => {
    expect(scanRequestSchema.safeParse({ ...validSite, siteUrl }).success).toBe(false);
  });

  it("rejects the app's own host when NEXT_PUBLIC_APP_URL is set", () => {
    const previous = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://launchcheck.example.com";
    try {
      expect(
        scanRequestSchema.safeParse({
          ...validSite,
          siteUrl: "https://launchcheck.example.com",
        }).success,
      ).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.NEXT_PUBLIC_APP_URL;
      } else {
        process.env.NEXT_PUBLIC_APP_URL = previous;
      }
    }
  });

  it.each([
    "https://gitlab.com/owner/repo",
    "https://github.com/onlyowner",
    "http://github.com/owner/repo",
    "https://github.com/owner/re po",
    "https://github.com//repo",
    "https://evilgithub.com/owner/repo",
    "https://github.com/owner",
    "github.com/owner/repo",
  ])("rejects invalid repo URL: %s", (repoUrl) => {
    expect(scanRequestSchema.safeParse({ ...validRepo, repoUrl }).success).toBe(false);
  });

  it("rejects unknown modes and non-object input", () => {
    expect(scanRequestSchema.safeParse({ ...validSite, mode: "everything" }).success).toBe(false);
    expect(scanRequestSchema.safeParse(null).success).toBe(false);
    expect(scanRequestSchema.safeParse("https://example.com").success).toBe(false);
  });
});
