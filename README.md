# LaunchCheck

LaunchCheck scans a live site URL and/or a public GitHub repo for launch-readiness risks and produces a plain-English, severity-ranked report of *potential* issues. It never claims a site or repo is secure.

## Setup

1. Install [pnpm](https://pnpm.io/) (this repo pins `pnpm@10.33.0`).
2. Copy env template and fill required values:

```bash
cp .env.example .env.local
```

Required for local app/db usage:

- `DATABASE_URL` — Neon Postgres connection string
- `NEXT_PUBLIC_APP_URL` — usually `http://localhost:3000`

3. Install and run:

```bash
pnpm install
pnpm db:migrate   # applies drizzle/ migrations (needs DATABASE_URL)
pnpm dev
```

## How the scan pipeline works (Phase 2A)

When a scan is requested, the Inngest function `scan.run` executes these steps:

1. `validate-and-resolve` — re-validates the stored URLs.
2. `mark-running` — marks the scan as running.
3. `scan-site` *(site scans only)* — inside a single step it:
   - fetches the home page once through the SSRF-safe fetcher (`safeFetch`),
   - fetches `/robots.txt` once and respects `Disallow` rules for `LaunchCheckBot`,
   - discovers up to 15 same-origin `<script src>` / `modulepreload` URLs and fetches
     them at concurrency 4 within a 25-second budget,
   - runs the registered site checks (`lib/scanner/registry.ts`) in parallel with a
     5-second per-check timeout — a failing check becomes a `check_errored` info
     finding and never fails the scan,
   - replaces the scan's `findings` rows (delete-then-insert, safe to retry) and
     returns only `{ findingCount }`.
4. `finalize` — marks the scan completed.

Phase 2A ships exactly one check: `site.headers.hsts` (missing or weak
`Strict-Transport-Security`). Findings are stored with secrets redacted and are
surfaced on `/scan/<id>` as severity counts plus the top finding titles once the
scan completes; the full report arrives in a later phase.

Repo scans skip `scan-site` entirely until Phase 3.

## Running a scan locally

Scans are queued through [Inngest](https://www.inngest.com/). To process them locally:

1. Start the Inngest dev server in a second terminal:

```bash
npx inngest-cli@latest dev
```

2. Point it at the app (default `http://localhost:3000/api/inngest`; the CLI usually syncs apps automatically — check `http://localhost:8288`).

3. Open `http://localhost:3000`, fill in the scan form, and submit. The app redirects to `/scan/<id>`, which polls every 2 seconds until the scan completes.

Notes:

- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are optional locally — an in-memory rate limiter (3 scans/hour/IP, 5 scans/day/domain) is used instead. They are **required in production**.
- `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` are optional locally with the dev server; **required in production**.
- Apply new migrations with `pnpm db:migrate` after pulling schema changes (generate them with `pnpm db:generate`).

## Environment variables

See [`.env.example`](.env.example) for the full list. Phase 0 validates `DATABASE_URL` and `NEXT_PUBLIC_APP_URL` as required; other keys are optional until later phases enable their features.

## Scripts

| Script | Purpose |
|---|---|
| `pnpm dev` | Start the Next.js dev server |
| `pnpm build` | Production build |
| `pnpm start` | Run the production server |
| `pnpm lint` | Biome lint + format check |
| `pnpm typecheck` | TypeScript `tsc --noEmit` |
| `pnpm test` | Vitest unit tests |
| `pnpm test:e2e` | Playwright e2e tests |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:migrate` | Apply Drizzle migrations |

## Notes

- Reports describe potential issues only.
- All services used by this project must stay on free plans.
