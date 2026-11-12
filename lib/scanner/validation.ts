import { z } from "zod";

/**
 * Shared scan-request schemas. This module must stay isomorphic: it is imported
 * by the client-side scan form, so it cannot import `url-validation.ts`
 * (node:net). The strict SSRF check is injected on the server via
 * `registerSiteUrlValidator` — see `validation.server.ts`.
 */

export type SiteUrlCheckResult = { ok: true } | { ok: false; message: string };
export type SiteUrlValidator = (input: string) => SiteUrlCheckResult;

let siteUrlValidator: SiteUrlValidator | null = null;

/**
 * Server-only: installs the strict validator (validateTargetUrl). Called once at
 * module load by `validation.server.ts`. Until then a permissive http(s) check
 * runs, which is safe because the server always re-validates before use.
 */
export function registerSiteUrlValidator(validator: SiteUrlValidator): void {
  siteUrlValidator = validator;
}

function checkSiteUrl(input: string): SiteUrlCheckResult {
  if (siteUrlValidator) {
    return siteUrlValidator(input);
  }
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, message: "Only http and https URLs are allowed." };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Enter a valid URL." };
  }
}

const siteUrlField = z
  .string()
  .trim()
  .min(1, "Enter a site URL.")
  .max(2048, "URL is too long.")
  .superRefine((value, ctx) => {
    const result = checkSiteUrl(value);
    if (!result.ok) {
      ctx.addIssue({ code: "custom", message: result.message });
    }
  });

// GitHub owner: 1-39 chars, alphanumeric or hyphen, no leading/trailing hyphen.
// Repo: 1-100 chars, starts alphanumeric, then letters/digits/._- ; optional
// ".git" suffix and a single trailing slash are allowed and ignored.
const GITHUB_REPO_URL =
  /^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}(?:\.git)?\/?$/;

export const repoUrlField = z
  .string()
  .trim()
  .min(1, "Enter a GitHub repo URL.")
  .max(2048, "URL is too long.")
  .regex(GITHUB_REPO_URL, "Use a public GitHub URL like https://github.com/owner/repo.");

const optionalUrlField = z
  .string()
  .trim()
  .max(2048, "URL is too long.")
  .optional()
  .or(z.literal(""));

export const scanModeSchema = z.enum(["site", "repo", "both"]);
export type ScanMode = z.infer<typeof scanModeSchema>;

export const scanRequestSchema = z
  .object({
    mode: scanModeSchema,
    siteUrl: optionalUrlField,
    repoUrl: optionalUrlField,
    acceptedOwnership: z
      .boolean()
      .refine(
        (value) => value === true,
        "Confirm you own this site or repo, or have permission to scan it.",
      ),
  })
  .superRefine((value, ctx) => {
    const hasSite = typeof value.siteUrl === "string" && value.siteUrl !== "";
    const hasRepo = typeof value.repoUrl === "string" && value.repoUrl !== "";

    if (value.mode === "site" || value.mode === "both") {
      if (!hasSite) {
        ctx.addIssue({
          code: "custom",
          path: ["siteUrl"],
          message: "Enter the site URL you want to scan.",
        });
      } else {
        const result = siteUrlField.safeParse(value.siteUrl);
        if (!result.success) {
          for (const issue of result.error.issues) {
            ctx.addIssue({ ...issue, path: ["siteUrl", ...issue.path] });
          }
        }
      }
    } else if (hasSite) {
      ctx.addIssue({
        code: "custom",
        path: ["siteUrl"],
        message: "Clear the site URL or switch the mode to Site or Both.",
      });
    }

    if (value.mode === "repo" || value.mode === "both") {
      if (!hasRepo) {
        ctx.addIssue({
          code: "custom",
          path: ["repoUrl"],
          message: "Enter the GitHub repo URL you want to scan.",
        });
      } else {
        const result = repoUrlField.safeParse(value.repoUrl);
        if (!result.success) {
          for (const issue of result.error.issues) {
            ctx.addIssue({ ...issue, path: ["repoUrl", ...issue.path] });
          }
        }
      }
    } else if (hasRepo) {
      ctx.addIssue({
        code: "custom",
        path: ["repoUrl"],
        message: "Clear the repo URL or switch the mode to Repo or Both.",
      });
    }
  });

export type ScanRequest = z.infer<typeof scanRequestSchema>;

/** Extract the hostname from an already-validated URL, or null. */
export function hostnameFromUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
