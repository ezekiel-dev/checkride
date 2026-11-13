import { hstsCheck } from "@/lib/scanner/checks/site/hsts";
import type { Check } from "@/lib/scanner/types";

/** Site checks enabled for this phase. Add new checks here as phases land. */
export const siteChecks: Check[] = [hstsCheck];
