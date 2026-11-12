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

## 2026-11-11 — Phase 1b scan pipeline

| Decision | Reason |
|---|---|
| Hand-wrote `drizzle/0001_anon_token_hash_step.sql` + snapshot/journal entries | `drizzle-kit generate` prompts interactively (rename vs create) and Windows PTY isn't available; drop+add chosen over rename so no raw token values could survive in `anon_token_hash` |
| `anon_token` dropped, `anon_token_hash` added (not renamed) | Old column could have held raw tokens; the hash column must only ever contain SHA-256 digests |
| Isomorphic `lib/scanner/validation.ts` + `validation.server.ts` that registers `validateTargetUrl` | The scan form (client component) needs the same Zod schema, but `url-validation.ts` uses `node:net` and cannot be bundled client-side. Server modules import `validation.server.ts`, which installs the strict check before use |
| `acceptedOwnership` is `z.boolean().refine(v => v === true)` instead of `z.literal(true)` | Identical runtime strictness (only boolean `true` passes) but keeps the form value type as `boolean`, avoiding casts in React Hook Form |
| Mode mismatched URLs are rejected, not ignored | `mode: "site"` with a repo URL filled in is almost certainly a user error; failing loudly beats silently scanning the wrong target |
| Repo URL regex: strict `https://github.com/<owner>/<repo>` with GitHub's owner charset, repo starting alphanumeric, optional `.git`/trailing slash | SPEC requires strict matching; full GitHub rules (reserved names, unicode) are approximated — documented as a heuristic |
| Per-domain rate limit keyed on site hostname, falling back to repo hostname (github.com) | "Same domain" most usefully means the target site; repo scans still count via the per-IP limit and github.com domain bucket |
| Inngest `scan.run` marks the scan `failed` then rethrows | Inngest retries transient failures; a retry can move the row back to `running`. Exhausted retries leave `failed` with a safe message |
| `scans.step` stores pipeline step ids (`validate-and-resolve`, `mark-running`, `finalize`); progress UI maps them onto the 6-item SPEC checklist | No real checks exist yet, so the mapping is approximate until Phase 2+ adds steps |
| `getEnv()` requires Upstash + Inngest keys only when `NODE_ENV=production`, exempting `phase-production-build` | CI builds without those secrets; runtime in production fails fast on misconfiguration while local dev stays key-free |
| Elapsed timer counts from page mount, not `created_at` | Simple and good enough for the skeleton; can be refined when the report UI lands |

## 2026-11-11 — Phase 1a SSRF-safe fetch

| Decision | Reason |
|---|---|
| Use Node `http`/`https` + custom `lookup`, not undici | Built-in; can pin the connect-time address after checking every DNS result |
| Request `Accept-Encoding: identity` only | Avoids gzip/br decompression bombs without extra stream complexity; size limit applies to bytes on the wire |
| Split `url-validation.ts` and `safe-fetch.ts` | Keeps pure URL/IP checks unit-testable without HTTP |
| Optional `lookup` / `checkIp` / `timeoutMs` / `maxBytes` / `connectPort` on `safeFetch` | Tests mock DNS and talk to an ephemeral loopback port while validated URLs stay on 80/443 |
| Read `NEXT_PUBLIC_APP_URL` directly in validation (not full `getEnv()`) | Unit tests should not require `DATABASE_URL`; app-host check only needs the public origin |
| Oversize bodies return `ok: true` with `truncated: true` | Matches the Phase 1a requirement to stream-cap and flag; `too_large` remains available for future hard-fail paths |

## 2026-11-12 — Scan progress checklist fix

| Decision | Reason |
|---|---|
| `lib/scanner/steps.ts` is the single source of truth for step ids, labels, and states | The UI previously hard-coded SPEC checklist labels for steps the pipeline never runs, so scans looked stuck; now Inngest writes `scans.step` and the UI renders exactly those steps |
| Only 4 steps exist (`queued`, `validate-and-resolve`, `mark-running`, `finalize`) | Mode-specific steps (`appliesTo: "site" | "repo"`) are supported by `stepsForMode` but none are added until the real checks land in Phases 2–3 |
| `onFailure` receives `{ event, step, error }` where `event.data.event` is the original triggering event | Verified against inngest 4.26.2 types (`FailureEventPayload`); the handler re-parses the nested event defensively and does nothing if it does not match |
| `NonRetriableError` for bad payload / missing scan / invalid stored URLs | These can never succeed on retry; transient errors keep Inngest's default retries and are only marked `failed` by `onFailure` after retries are exhausted |
| `scans.step` is kept (not cleared) when a scan fails | Lets the UI show which step failed; the progress page still shows the friendly failed screen for `status: "failed"` |
| GET `/api/scans/[id]` derives `mode` from stored URLs and returns `Cache-Control: no-store` | The UI needs the mode to render the right checklist; URLs, token hash, and error text are never exposed |
| `anonTokenHashEquals` returns false for empty inputs | An empty stored hash or cookie must never compare equal, even to another empty string |
| Elapsed timer computes from server `createdAt` | A page reload mid-scan no longer resets the `T+MM:SS` timer |
