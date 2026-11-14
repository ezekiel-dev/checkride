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

## 2026-11-13 — Phase 2A check framework, snapshot, persistence

| Decision | Reason |
|---|---|
| `RawFinding.evidence` is already redacted; persistence truncates it to 500 chars and `location` to 300 | SPEC 4.3 redaction rule; column caps keep rows small (AGENTS free-tier discipline) |
| Snapshot treats home-page HTTP status >= 400 as `site_unreachable` | `safeFetch` returns `ok: true` for HTTP errors; a scanner should not report on an error page |
| Snapshot notes become `info` findings with `checkId: "site.snapshot.notes"`, category `reliability` | SPEC requires skipped-fetch budgets to surface as info findings; reliability is the closest category for fetch-budget notes |
| Script discovery uses regex over `<script src>` and `<link rel="modulepreload">`, resolved against `finalUrl`, same-origin only, deduped, capped at 15 | SPEC 4.3 budgets; no HTML-parser dependency allowed |
| robots.txt disallows are checked per script path for `LaunchCheckBot`, with `*` groups as fallback and longest-match/allow-tie precedence | SPEC 7.4 + 4.3; missing/garbage robots.txt means allow all |
| Script fetches run at concurrency 4 with a shared deadline checked before each fetch; leftovers are counted once as skipped | SPEC 4.3 budgets; avoids double-counting when several workers hit the deadline |
| `persistFindings` uses a transaction only when the driver supports it; neon-http's `transaction()` exists but always throws "No transactions support", so it falls back to sequential delete+insert | SPEC requires idempotent persistence; delete-then-insert is already idempotent, the transaction is only an optimization where available |
| `runChecks` normalizes `finding.checkId` to the check's own id and converts throws/timeouts into a single `check_errored` info finding | SPEC 4.3: one bad check must never fail the scan |
| `maxDuration = 60` exported from `/api/inngest` | Inngest sync + snapshot/check work can exceed the default serverless limit; noted if the Next 16 build rejects the segment config |
| HSTS "weak" finding uses severity `low`, confidence `high` | Prompt's "low/high-confidence" read parallel to "medium/high-confidence" = severity/confidence pair; SPEC 4.1 lists hsts guidance as medium overall |
| Fixture server is plain HTTP, so scheme-dependent checks (HSTS) self-skip in fixture-server tests; HTTPS behavior is tested via a stub fetcher reporting an `https://` `finalUrl` | `safeFetch` cannot do TLS to the fixture server; stubbing `finalUrl` exercises the same check logic without real network |

## 2026-11-13 — Phase 2A follow-up: batch persist, snapshot budgets, retries

| Decision | Reason |
|---|---|
| `persistFindings` uses `db.batch([delete, insert])` (delete only when empty) instead of a transaction | drizzle-orm 0.44.5 neon-http supports `batch` (single HTTP round-trip); removes the transaction try/catch entirely |
| `location` stored as `origin + pathname` when it parses as a URL, else truncated to 300 | Query strings/fragments can carry tokens (`?token=...`) |
| `title` capped at 200 chars | Keeps finding rows small; titles are display strings |
| Script responses skipped when `finalUrl` origin differs from the page origin or content-type is image/video/audio/font | safeFetch follows redirects; off-origin or binary responses are not useful scan input |
| 25 MB total byte budget across HTML + script bodies, checked before each script fetch | SPEC 4.3 budget; shared counter may overshoot by one in-flight batch — accepted as a guard, not a hard cap |
| `retries: 2` on `scan.run` | Explicit cap instead of the SDK default; transient errors get two retries before `onFailure` marks the scan failed |
