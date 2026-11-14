import { safeFetch } from "@/lib/scanner/safe-fetch";
import type { Fetcher } from "@/lib/scanner/types";

/** The fetcher used by the real pipeline: safeFetch with default limits. */
export const productionFetcher: Fetcher = (url) => safeFetch(url);
