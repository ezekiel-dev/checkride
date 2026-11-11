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
