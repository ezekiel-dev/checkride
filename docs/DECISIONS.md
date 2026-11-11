# Decisions

## 2026-11-10 — Phase 0 foundation choices

| Decision | Reason |
|---|---|
| Use Biome instead of ESLint + Prettier | SPEC allows either; Biome is one tool and matches AGENTS.md |
| Keep `payments.user_id` and `scans.user_id` as UUID columns without FK to `users` | Auth tables are deferred to Phase 5; avoid orphan FKs |
| Enum columns for scan status, finding category/severity/confidence/effort, and payment status | Narrows invalid values at the DB layer while matching SPEC section 8 shapes |
| Validate env via `getEnv()` (lazy) rather than import-time parse | Lets lint/typecheck/unit tests run without loading secrets; CI supplies placeholders for build |
| CI sets placeholder `DATABASE_URL` / `NEXT_PUBLIC_APP_URL` | Build needs the public URL; DB is not contacted during `next build` for Phase 0 |
| Manually add shadcn `Button` + `components.json` instead of interactive CLI | Non-interactive scaffold; same file layout shadcn expects |
| Pin exact dependency versions in `package.json` | SPEC section 2 requires pinning at build time |
| `.gitignore` ignores `.env*` locals but keeps `.env.example` tracked | Secrets stay local; template stays in repo |
| `typecheck` runs `next typegen` before `tsc` | Next 16 `next-env.d.ts` references `.next/types`; typegen makes CI typecheck work before build |
| Root layout uses `{ children: React.ReactNode }` instead of `LayoutProps` | Avoid depending on generated route types for a one-file layout |

## 2026-11-11 — Phase 1a SSRF-safe fetch

| Decision | Reason |
|---|---|
| Use Node `http`/`https` + custom `lookup`, not undici | Built-in; can pin the connect-time address after checking every DNS result |
| Request `Accept-Encoding: identity` only | Avoids gzip/br decompression bombs without extra stream complexity; size limit applies to bytes on the wire |
| Split `url-validation.ts` and `safe-fetch.ts` | Keeps pure URL/IP checks unit-testable without HTTP |
| Optional `lookup` / `checkIp` / `timeoutMs` / `maxBytes` / `connectPort` on `safeFetch` | Tests mock DNS and talk to an ephemeral loopback port while validated URLs stay on 80/443 |
| Read `NEXT_PUBLIC_APP_URL` directly in validation (not full `getEnv()`) | Unit tests should not require `DATABASE_URL`; app-host check only needs the public origin |
| Oversize bodies return `ok: true` with `truncated: true` | Matches the Phase 1a requirement to stream-cap and flag; `too_large` remains available for future hard-fail paths |
