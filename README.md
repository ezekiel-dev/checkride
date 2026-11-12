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

## Running a scan locally (Phase 1B)

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
