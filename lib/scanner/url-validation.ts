import { BlockList, isIPv4, isIPv6 } from "node:net";

/**
 * URL and IP helpers for SSRF-safe fetching.
 * This module must never run on the Edge runtime (uses node:net).
 * Prefer importing via `lib/scanner/safe-fetch.ts` from Node.js route handlers / Inngest.
 */

export type UrlValidationReason =
  | "invalid_url"
  | "blocked_scheme"
  | "credentials"
  | "blocked_port"
  | "ip_literal"
  | "blocked_hostname"
  | "app_host";

export type ValidateUrlResult =
  | { ok: true; url: URL }
  | { ok: false; reason: UrlValidationReason; message: string };

const BLOCKED_SUFFIXES = [".local", ".localhost", ".internal", ".lan"] as const;
const ALLOWED_PORTS = new Set(["", "80", "443"]);

const blockList = new BlockList();

// IPv4 ranges
blockList.addSubnet("0.0.0.0", 8, "ipv4");
blockList.addSubnet("10.0.0.0", 8, "ipv4");
blockList.addSubnet("100.64.0.0", 10, "ipv4");
blockList.addSubnet("127.0.0.0", 8, "ipv4");
blockList.addSubnet("169.254.0.0", 16, "ipv4");
blockList.addSubnet("172.16.0.0", 12, "ipv4");
blockList.addSubnet("192.0.0.0", 24, "ipv4");
blockList.addSubnet("192.0.2.0", 24, "ipv4");
blockList.addSubnet("192.168.0.0", 16, "ipv4");
blockList.addSubnet("198.18.0.0", 15, "ipv4");
blockList.addSubnet("198.51.100.0", 24, "ipv4");
blockList.addSubnet("203.0.113.0", 24, "ipv4");
blockList.addSubnet("224.0.0.0", 4, "ipv4");
blockList.addSubnet("240.0.0.0", 4, "ipv4");

// IPv6 ranges and addresses
blockList.addAddress("::", "ipv6");
blockList.addAddress("::1", "ipv6");
blockList.addSubnet("fc00::", 7, "ipv6");
blockList.addSubnet("fe80::", 10, "ipv6");
blockList.addSubnet("ff00::", 8, "ipv6");
blockList.addSubnet("2001:db8::", 32, "ipv6");
blockList.addAddress("fd00:ec2::254", "ipv6");

function stripBrackets(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function looksLikeIpv4Literal(hostname: string): boolean {
  if (isIPv4(hostname)) {
    return true;
  }
  // Reject ambiguous numeric forms that WHATWG may not always normalize.
  if (/^\d+$/.test(hostname)) {
    return true;
  }
  if (/^0x[0-9a-f]+$/i.test(hostname)) {
    return true;
  }
  if (/^(?:\d+|0x[0-9a-f]+)(?:\.(?:\d+|0x[0-9a-f]+)){1,3}$/i.test(hostname)) {
    return true;
  }
  return false;
}

export function isHostnameIpLiteral(hostname: string): boolean {
  const host = stripBrackets(hostname.toLowerCase());
  return isIPv6(host) || looksLikeIpv4Literal(host);
}

function getAppHostname(appUrl = process.env.NEXT_PUBLIC_APP_URL): string | null {
  if (!appUrl || appUrl.trim() === "") {
    return null;
  }
  try {
    return stripBrackets(new URL(appUrl).hostname).toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Parse and validate a user-supplied target URL for SSRF safety (pre-DNS checks).
 * Never throws on bad input.
 */
export function validateTargetUrl(input: string, options?: { appUrl?: string }): ValidateUrlResult {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, reason: "invalid_url", message: "The URL could not be parsed." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      reason: "blocked_scheme",
      message: "Only http and https URLs are allowed.",
    };
  }

  if (parsed.username !== "" || parsed.password !== "") {
    return {
      ok: false,
      reason: "credentials",
      message: "URLs must not include usernames or passwords.",
    };
  }

  if (!ALLOWED_PORTS.has(parsed.port)) {
    return {
      ok: false,
      reason: "blocked_port",
      message: "Only default ports 80 and 443 are allowed.",
    };
  }

  const hostname = stripBrackets(parsed.hostname).toLowerCase();

  if (isHostnameIpLiteral(parsed.hostname) || isHostnameIpLiteral(hostname)) {
    return {
      ok: false,
      reason: "ip_literal",
      message: "IP address literals are not allowed.",
    };
  }

  if (hostname === "localhost" || BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return {
      ok: false,
      reason: "blocked_hostname",
      message: "That hostname is not allowed.",
    };
  }

  const appHost = getAppHostname(options?.appUrl);
  if (appHost && hostname === appHost) {
    return {
      ok: false,
      reason: "app_host",
      message: "Scanning this application is not allowed.",
    };
  }

  const normalized = new URL(parsed.toString());
  normalized.hostname = hostname;

  return { ok: true, url: normalized };
}

function embeddedIpv4FromMapped(ip: string): string | null {
  const dotted = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (dotted) {
    return dotted[1];
  }

  const hex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) {
    return null;
  }

  const hi = Number.parseInt(hex[1], 16);
  const lo = Number.parseInt(hex[2], 16);
  if (Number.isNaN(hi) || Number.isNaN(lo)) {
    return null;
  }

  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/**
 * Returns true when the IP must not be contacted (private, loopback, link-local, metadata, etc.).
 * Unknown / unparseable addresses are treated as blocked.
 */
export function isBlockedIp(ip: string): boolean {
  const trimmed = stripBrackets(ip.trim());
  if (trimmed === "") {
    return true;
  }

  const embedded = embeddedIpv4FromMapped(trimmed);
  if (embedded) {
    return isBlockedIp(embedded);
  }

  if (isIPv4(trimmed)) {
    return blockList.check(trimmed, "ipv4");
  }

  if (isIPv6(trimmed)) {
    return blockList.check(trimmed, "ipv6");
  }

  return true;
}
