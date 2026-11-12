import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scans } from "@/lib/db/schema";
import { ANON_TOKEN_COOKIE, anonTokenHashEquals, hashAnonToken } from "@/lib/scan-token";
import type { ScanMode } from "@/lib/scanner/steps";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" } as const;

function notFound() {
  return NextResponse.json({ error: "Not found." }, { status: 404, headers: NO_STORE });
}

function scanMode(siteUrl: string | null, repoUrl: string | null): ScanMode | null {
  if (siteUrl && repoUrl) {
    return "both";
  }
  if (siteUrl) {
    return "site";
  }
  if (repoUrl) {
    return "repo";
  }
  return null;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return notFound();
  }

  const token = request.cookies.get(ANON_TOKEN_COOKIE)?.value;
  if (!token) {
    return notFound();
  }

  const tokenHash = hashAnonToken(token);

  try {
    const db = getDb();
    const [scan] = await db
      .select({
        id: scans.id,
        status: scans.status,
        step: scans.step,
        siteUrl: scans.siteUrl,
        repoUrl: scans.repoUrl,
        anonTokenHash: scans.anonTokenHash,
        createdAt: scans.createdAt,
        completedAt: scans.completedAt,
      })
      .from(scans)
      .where(eq(scans.id, id))
      .limit(1);

    if (!scan || !scan.anonTokenHash || !anonTokenHashEquals(tokenHash, scan.anonTokenHash)) {
      return notFound();
    }

    return NextResponse.json(
      {
        id: scan.id,
        status: scan.status,
        step: scan.step,
        mode: scanMode(scan.siteUrl, scan.repoUrl),
        createdAt: scan.createdAt ? scan.createdAt.toISOString() : null,
        completedAt: scan.completedAt ? scan.completedAt.toISOString() : null,
      },
      { headers: NO_STORE },
    );
  } catch {
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500, headers: NO_STORE },
    );
  }
}
