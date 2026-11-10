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
pnpm db:migrate   # after DATABASE_URL is set
pnpm dev
```

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
