import { validateTargetUrl } from "@/lib/scanner/url-validation";
import { registerSiteUrlValidator, type SiteUrlCheckResult } from "@/lib/scanner/validation";

/**
 * Server-only entry point for scan validation. Registers the strict SSRF-aware
 * site URL check (validateTargetUrl) before the shared schema is used, then
 * re-exports it. Import this — never the bare validation module — from route
 * handlers, Inngest functions, and tests that need the strict checks.
 */
registerSiteUrlValidator((input): SiteUrlCheckResult => {
  const result = validateTargetUrl(input);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return { ok: true };
});

export {
  hostnameFromUrl,
  type ScanMode,
  type ScanRequest,
  scanModeSchema,
  scanRequestSchema,
} from "@/lib/scanner/validation";
