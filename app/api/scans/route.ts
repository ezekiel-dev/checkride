import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scans } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest/client";
import { checkScanRateLimits, getClientIp } from "@/lib/ratelimit";
import {
  ANON_TOKEN_COOKIE,
  ANON_TOKEN_MAX_AGE_SECONDS,
  generateAnonToken,
  hashAnonToken,
} from "@/lib/scan-token";
import { hostnameFromUrl, scanRequestSchema } from "@/lib/scanner/validation.server";

// Node.js runtime is the default; `runtime` segment config is unavailable
// while cacheComponents is enabled in next.config.ts.

function errorResponse(status: number, message: string, headers?: HeadersInit) {
  return NextResponse.json({ error: message }, { status, headers });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = scanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, "Invalid scan request.");
  }
  const data = parsed.data;

  const ip = getClientIp(request.headers);
  const domain =
    (data.mode !== "repo" ? hostnameFromUrl(data.siteUrl) : null) ??
    (data.mode !== "site" ? hostnameFromUrl(data.repoUrl) : null);

  const rateLimit = await checkScanRateLimits({ ip, domain });
  if (!rateLimit.allowed) {
    if (rateLimit.status === 503) {
      return errorResponse(503, "Scan service is temporarily unavailable. Please try again later.");
    }
    const headers: HeadersInit = {};
    if (rateLimit.retryAfterSeconds) {
      headers["Retry-After"] = String(rateLimit.retryAfterSeconds);
    }
    return errorResponse(429, "Too many scans. Please wait a while and try again.", headers);
  }

  const token = generateAnonToken();
  const tokenHash = hashAnonToken(token);

  const siteUrl = data.mode === "repo" ? null : (data.siteUrl ?? null);
  const repoUrl = data.mode === "site" ? null : (data.repoUrl ?? null);

  const db = getDb();
  let scanId: string;
  try {
    const [row] = await db
      .insert(scans)
      .values({
        siteUrl: siteUrl || null,
        repoUrl: repoUrl || null,
        anonTokenHash: tokenHash,
        status: "queued",
      })
      .returning({ id: scans.id });
    scanId = row.id;
  } catch {
    return errorResponse(500, "Something went wrong. Please try again.");
  }

  try {
    await inngest.send({ name: "scan/requested", data: { scanId } });
  } catch {
    try {
      await db
        .update(scans)
        .set({ status: "failed", error: "enqueue_failed" })
        .where(eq(scans.id, scanId));
    } catch {
      // Best effort: the row already exists; the failure is logged by Inngest client.
    }
    return errorResponse(500, "Something went wrong. Please try again.");
  }

  const response = NextResponse.json({ id: scanId }, { status: 201 });
  response.cookies.set({
    name: ANON_TOKEN_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ANON_TOKEN_MAX_AGE_SECONDS,
  });
  return response;
}
