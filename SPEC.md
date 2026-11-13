# SPEC.md: LaunchCheck

> Launch-readiness scanner for AI-built apps (Lovable, Bolt, v0, Cursor, Replit).
> A founder submits a live site URL and/or a public GitHub repo URL and receives a plain-English, severity-ranked report of security, reliability, and performance risks.

This file is the single source of truth. Read it fully before writing code. Follow the phases in order. Do not add features that are not listed. If something is ambiguous, choose the simplest option, record the decision in `docs/DECISIONS.md`, and continue.

---

## 1. Goals and non-goals

### Goals
- Working, deployed MVP that a non-technical founder can use in under 60 seconds.
- Portfolio-grade code: typed, tested, documented, clean commit history.
- Demonstrates: auth, payments, background jobs, third-party APIs, AI integration, PDF export, rate limiting, secure URL fetching.

### Non-goals (do NOT build)
- Active exploitation, port scanning, fuzzing, or anything resembling penetration testing.
- Scanning private repos (v1 supports public repos only).
- Multi-tenant teams, orgs, or admin panels.
- Mobile app, browser extension, or CI plugin.
- Claims of "secure". The tool reports *potential issues* only.

---

## 2. Tech stack

Use the latest stable versions at build time and pin them exactly in `package.json`. Use `pnpm`.

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js (App Router)** | React Server Components, Server Actions where sensible, Route Handlers for APIs |
| Language | **TypeScript (strict)** | `"strict": true`, no `any` without a comment |
| Styling | **Tailwind CSS v4** | Utility-first, CSS-first config |
| UI components | **shadcn/ui** (Radix primitives) | Copy components in, do not wrap in a custom library |
| Icons | **lucide-react** | |
| Fonts | `next/font/google`: Instrument Serif, Geist Sans, Geist Mono | See section 11.3 |
| Motion | **Motion** (`motion/react`) or CSS only | Respect `prefers-reduced-motion`. See 11.7 |
| Theming | **next-themes** | Light "Paper" and dark "Night ops" tokens, see 11.2 |
| Forms and validation | **React Hook Form + Zod** | Share Zod schemas between client and server |
| Client data | **TanStack Query** | Polling scan status |
| Database | **Postgres on Neon** | Serverless, free tier |
| ORM | **Drizzle ORM + drizzle-kit** | Migrations committed to repo |
| Auth | **Better Auth** (GitHub OAuth primary, email magic link secondary) | Drizzle adapter. Clerk is an acceptable swap if keys are provided |
| Background jobs | **Inngest** | Scans run as durable multi-step functions |
| Rate limiting | **Upstash Redis + @upstash/ratelimit** | Per-IP and per-user |
| AI | **Vercel AI SDK + Google Gemini (`@ai-sdk/google`) on the free tier** | `generateObject` with Zod schema. Provider-swappable (see section 6) |
| GitHub access | **Octokit** | Unauthenticated or token-based, public repos only |
| Payments | **Stripe** (Checkout + webhooks) | No monthly fee. **Test mode only (free)** until told otherwise |
| Email | **Resend (free plan)** | Report delivery and magic links. Low daily cap, so email is optional (see 2.1) |
| PDF | **@react-pdf/renderer** | Works on serverless, no headless browser |
| Observability | **Sentry** + structured logs (`pino`) | |
| Testing | **Vitest** (unit/integration), **Playwright** (e2e) | |
| Lint/format | **Biome** (or ESLint + Prettier, pick one) | |
| CI | **GitHub Actions** | lint, typecheck, test, build on every PR |
| Hosting | **Vercel Hobby (free)** | Preview deployments per PR. Hobby is for non-commercial use, see 2.1 |

### 2.1 Free-tier constraints (all services must stay on free plans)

Every service below must be used on its free plan. Do not add any paid service. Check each provider's current free-tier limits before building, because they change.

| Service | Free plan used | Constraint to design around |
|---|---|---|
| Vercel | Hobby | Non-commercial use only. Fine for portfolio and test-mode payments. Before charging real money, move to Cloudflare Pages, Render, or Fly.io free options, or upgrade |
| Neon | Free Postgres | Storage and compute caps. Keep rows small and delete raw bundle/file content after scanning |
| Upstash Redis | Free | Daily command cap. Use sliding-window rate limits only on write endpoints |
| Inngest | Hobby/free | Monthly execution cap. Keep steps coarse (about 9 per scan) |
| Gemini API | Free tier via Google AI Studio | Per-minute and per-day request caps, set per project and shown in AI Studio. Free-tier requests may be used by Google to improve its products, so send only redacted findings |
| Resend | Free plan | Small daily and monthly email caps. Email is optional: GitHub sign-in is primary, and the report page plus PDF download never depend on email |
| Sentry | Developer (free) | Low event quota. Sample traces at a low rate |
| GitHub API / OSV.dev | Free | Use a `GITHUB_TOKEN` for higher limits. OSV.dev is a free public API |
| Stripe | Test mode | No cost in test mode. Real payments incur per-transaction fees, so keep test mode until launch |
| GitHub Actions | Free minutes | Cache pnpm and Playwright browsers |

If any free limit is hit, the app must degrade gracefully (fallback explanations, "email unavailable, download your PDF instead") and never crash a scan.

---

## 3. Core user flows

1. **Anonymous quick scan.** User enters a site URL (and optionally a GitHub repo URL) on the landing page, passes a Turnstile/captcha-free rate limit, and sees a progress page, then a **summary** (score + count of findings per severity + top 3 findings, titles only).
2. **Unlock full report.** User signs in, pays a one-time fee via Stripe Checkout (or uses a free credit on first scan), and sees full findings with explanations and fixes. Can download a PDF and receive it by email.
3. **Dashboard.** Signed-in user sees past scans, statuses, and re-scan button.
4. **Call to action.** Every full report ends with a "Need help fixing these?" CTA linking to a configurable booking URL (`NEXT_PUBLIC_BOOKING_URL`).

---

## 4. Scanner checks (MVP: exactly these)

Each check is a pure, independently testable module implementing:

```ts
interface Check {
  id: string;                 // e.g. "site.headers.csp"
  category: "security" | "secrets" | "performance" | "reliability";
  target: "site" | "repo";
  run(ctx: ScanContext): Promise<RawFinding[]>;
}

interface RawFinding {
  checkId: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;              // short, technical
  evidence: string;           // redacted snippet, header value, file path + line
  location?: string;          // URL or repo path
  confidence: "high" | "medium" | "low";
}
```

### 4.1 Live site checks
| ID | What it does | Severity guidance |
|---|---|---|
| `site.headers.hsts` | Missing/weak `Strict-Transport-Security` | medium |
| `site.headers.csp` | Missing `Content-Security-Policy` | medium |
| `site.headers.frame` | Missing `X-Frame-Options` / `frame-ancestors` | low |
| `site.headers.misc` | Missing `X-Content-Type-Options`, `Referrer-Policy` | low |
| `site.https.redirect` | HTTP does not redirect to HTTPS | high |
| `site.bundle.secrets` | Fetch same-origin JS bundles (cap count and size) and regex for secrets | critical |
| `site.backend.supabase` | Detect Supabase project URL + anon key in bundles; flag for manual RLS review. Do not query their database | high (info if only anon key present, which is expected) |
| `site.backend.firebase` | Detect Firebase config; flag for manual rules review. Do not query their database | medium |
| `site.perf.basic` | Response time (TTFB), HTML size, total JS size, image count without `width/height`/lazy loading | low-medium |
| `site.cookies` | Cookies missing `Secure`/`HttpOnly`/`SameSite` | medium |

### 4.2 Repo checks (public GitHub only)
| ID | What it does | Severity guidance |
|---|---|---|
| `repo.secrets.patterns` | Regex scan of text files for Stripe secret keys, AWS keys, private keys, generic high-entropy tokens, Supabase `service_role` keys | critical |
| `repo.env.committed` | `.env`, `.env.local`, `.env.production` present in repo | critical |
| `repo.deps.audit` | Parse `package.json` + lockfile, query the OSV.dev API for known vulnerabilities, summarize by severity | varies |
| `repo.stripe.webhook` | Route handlers that handle Stripe events without `constructEvent`/signature verification (pattern heuristic) | high |
| `repo.api.noauth` | Next.js route handlers/Server Actions that touch the database with no visible session/auth check (heuristic) | medium, confidence low-medium |
| `repo.supabase.rls` | SQL migrations that create tables without `enable row level security` | high |
| `repo.quality.basics` | No tests, no `.gitignore` for env files, no README, no lockfile | low |

### 4.3 Rules for all checks
- **Redact secrets.** Never store or display a full secret. Store the first 4 and last 2 characters only, with the rest masked.
- Prefer **false negatives over false positives**. Every heuristic finding must carry a `confidence` value and use "potential issue" language in the UI.
- Each check has unit tests with positive and negative fixtures in `/fixtures`.
- A failure in one check must never fail the whole scan. Record it as `check_errored` and continue.
- **All network access goes through an injected fetcher.** Checks never import `safeFetch` directly. They receive `ctx.fetch(url)` (production: `safeFetch` with defaults), so tests can inject a fixture fetcher that uses the test-only `lookup`/`checkIp`/`connectPort` options against a local server.
- **Fetch once, check many.** The pipeline builds one `SiteSnapshot` (home page response, headers, HTML, fetch time, same-origin script bodies) and checks are pure functions over it, except checks that explicitly need an extra request (for example `site.https.redirect`).
- **Budgets:** whole snapshot phase at most 25 seconds; at most 15 same-origin script files; bundle fetch concurrency 4; each script capped by safeFetch's 5 MB limit (record `truncated`). When a budget is exhausted, skip the rest and record an `info` finding saying so; never fail the scan.
- **robots.txt:** fetch `/robots.txt` once. If it disallows `LaunchCheckBot` (or `*`) for a path, do not fetch that path (the home page the user submitted is always fetched; scripts and extra paths are skipped with an `info` finding).
- **Inngest step outputs must stay small.** Never return the snapshot, HTML, or bundle bodies from a `step.run` (step results are serialized and persisted). Fetch, check, and persist findings inside ONE step and return only small counts.

---

## 5. Scoring

- Start at 100. Deduct: critical -25, high -12, medium -5, low -2, info 0. Floor at 0.
- Multiply deduction by 0.5 for `confidence: "low"`.
- Cap total deduction per check id at 2x its base value (prevents one noisy check from zeroing the score).
- Grade bands: 90-100 "Looks good", 70-89 "Needs attention", 40-69 "Risky", 0-39 "Not launch-ready".
- Implement in `lib/scoring.ts` as a pure function with unit tests.

---

## 6. AI explanation layer

- Input: array of `RawFinding` (already redacted). **Never send raw secrets or full source files to the LLM.**
- Use Vercel AI SDK `generateObject` with the **Google provider (`@ai-sdk/google`) on the free tier**, and this Zod schema:

```ts
const ExplainedFinding = z.object({
  checkId: z.string(),
  plainTitle: z.string().max(90),
  whyItMatters: z.string().max(400),     // non-technical founder language
  suggestedFix: z.string().max(600),     // concrete steps; include a short code snippet if useful
  effort: z.enum(["5 min", "1 hour", "half day", "1+ day"]),
});
```

- System prompt rules: plain English, no fear-mongering, no guarantees, say "potential issue" for low-confidence findings, never invent findings that are not in the input.
- Validate output with Zod; on failure retry once, then fall back to a deterministic template from `lib/explanations/fallbacks.ts`.
- Track token usage per scan in the DB. Hard cap input size.
- Model name comes from `AI_MODEL` env var (default: a current Gemini Flash or Flash-Lite model that is listed as free in Google AI Studio). Do not hardcode.
- Keep the AI layer behind a single `explainFindings()` function so the provider can be swapped (OpenRouter free models, Groq free tier, or a paid Claude/OpenAI model) by changing one file and the env vars. Do not leak provider-specific types outside `lib/ai/`.
- **Free-tier survival rules:**
  - Send **one batched request per scan** (max 20 findings), never one request per finding.
  - Wrap calls in retry with exponential backoff and jitter on HTTP 429, max 3 attempts.
  - Add a global daily AI budget counter in Redis (`AI_DAILY_CALL_LIMIT`, default 200). When exceeded, skip the AI call and use the fallback templates.
  - Cache explanations by `checkId + normalized evidence hash` in the DB so repeated findings do not trigger new calls.
  - Fallback templates (`lib/explanations/fallbacks.ts`) must be good enough to ship a complete report on their own. The AI layer is an enhancement, not a dependency.

---

## 7. Security requirements (critical, this is a security tool)

1. **SSRF protection** for all user-supplied URLs:
   - Allow only `http` and `https`, ports 80/443. Reject URLs containing credentials, IP literals (including decimal/hex forms), `localhost`, and `.local`/`.localhost`/`.internal`/`.lan` hostnames.
   - **Block private, loopback, link-local, reserved, multicast, and cloud-metadata ranges**, IPv4 and IPv6, including IPv4-mapped IPv6 addresses. Minimum list: 0/8, 10/8, 100.64/10, 127/8, 169.254/16 (cloud metadata), 172.16/12, 192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4, `::`, `::1`, fc00::/7, fe80::/10, ff00::/8, 2001:db8::/32, fd00:ec2::254. Use Node's built-in `node:net` `BlockList`.
   - **Validate at connection time:** use a custom DNS `lookup` on the actual connection, check every returned address, and block if any is disallowed. This defeats DNS rebinding because the checked IP is the connected IP.
   - Handle redirects manually (max 3 hops) and re-validate URL and IP on every hop. Never follow redirects automatically.
   - Timeout 10s, max response size 5 MB enforced while streaming (including decompressed size), max 15 bundle files per scan. Only GET and HEAD. Never forward cookies or auth headers.
   - Errors use safe reason codes (`blocked_url`, `blocked_ip`, `too_many_redirects`, `timeout`, `too_large`, `network_error`) and never leak internal IPs or stack traces.
   - The fetcher runs only on the Node.js runtime, never Edge.
2. **Abuse controls:** rate limit anonymous scans to 3/hour/IP and signed-in users to 20/day. Block scanning the same domain more than 5 times per day. In production, if the rate-limit store is unavailable, **fail closed** (503). An in-memory limiter is allowed only when `NODE_ENV` is not production.
3. **Ownership note:** The UI must state "Only scan sites and repos you own or have permission to test" and require a checkbox before scanning.
4. **User-Agent:** `LaunchCheckBot/1.0 (+https://<domain>/bot)`; add a `/bot` page explaining what it does and how to opt out. Respect `robots.txt` disallow for `LaunchCheckBot` for site fetches beyond the home page.
5. No scanning of `localhost`, IPs, or the app's own domain.
6. Validate every input with Zod. Parameterized queries only (Drizzle). CSRF-safe Server Actions. Secure, HttpOnly cookies.
7. Verify Stripe webhooks with the signing secret. Make webhook handling idempotent.
8. Set strict security headers on LaunchCheck itself (CSP, HSTS, etc.). The app must pass its own scanner with a score of 90+.
9. Secrets only in env vars. Provide `.env.example` with every variable and a comment.

---

## 8. Data model (Drizzle)

```
users            id, email, name, created_at          (managed by Better Auth)
sessions/accounts                                      (managed by Better Auth)

scans
  id (uuid), user_id (nullable), anon_token_hash (nullable, SHA-256 of the cookie token; never store the raw token),
  site_url (nullable), repo_url (nullable),
  status (queued|running|completed|failed), step (text, nullable; current pipeline step for the progress UI),
  score (int, nullable), grade (text, nullable),
  unlocked (bool, default false), error (text, nullable),
  ai_input_tokens, ai_output_tokens, created_at, completed_at

findings
  id, scan_id (fk), check_id, category, severity, confidence,
  title, evidence_redacted, location,
  plain_title, why_it_matters, suggested_fix, effort,   -- filled by AI layer
  created_at

payments
  id, user_id (fk), scan_id (fk), stripe_session_id (unique), stripe_payment_intent,
  amount, currency, status, created_at

rate_limit_events (optional, if not using Redis only)
```

Add indexes on `scans(user_id, created_at)`, `findings(scan_id)`, `payments(stripe_session_id)`.

---

## 9. Routes

### Pages
- `/` landing page + scan form
- `/scan/[id]` progress, then summary or full report
- `/dashboard` past scans (auth required)
- `/pricing`
- `/bot` crawler info
- `/privacy`, `/terms`

### Route Handlers / Server Actions
- `POST /api/scans` create scan (validate, rate limit, enqueue Inngest event)
- `GET /api/scans/[id]` scan status and results (summary-only unless unlocked and authorized)
- `POST /api/checkout` create Stripe Checkout session for a scan
- `POST /api/webhooks/stripe` verify signature, mark scan unlocked
- `GET /api/scans/[id]/pdf` stream PDF (requires unlocked + ownership)
- `POST /api/inngest` Inngest serve endpoint

---

## 10. Inngest scan pipeline

Function `scan.run`, triggered by event `scan/requested`. Steps (each `step.run`, so retries are isolated):

1. `validate-and-resolve`: re-validate URLs, resolve DNS.
2. `fetch-site-snapshot`: headers, HTML, bundle list (if site_url).
3. `run-site-checks`: run in parallel with per-check timeouts.
4. `fetch-repo-tree`: Octokit tree + selected file contents (size caps) (if repo_url).
5. `run-repo-checks`.
6. `persist-raw-findings`.
7. `score`.
8. `explain-with-ai`: batch findings (max 20 per call).
9. `finalize`: set status, score, grade. Send email if user is signed in.

On unrecoverable error set `status = failed` with a safe error message.

**Implemented pipeline as of Phase 2:** `validate-and-resolve`, `mark-running`, `scan-site` (only when a site URL exists: build snapshot, run site checks, replace this scan's findings rows, return only counts), `finalize`. Persisting findings is idempotent: delete the scan's existing findings, then insert, so retries never duplicate rows.

---

## 11. UI and design requirements

### 11.1 Design concept: "Pre-flight"

LaunchCheck should feel like the checklist a pilot runs before takeoff: calm, precise, and a little bit editorial. It is **not** another purple-gradient SaaS template.

Three principles drive every decision:
1. **Color is reserved for meaning.** The interface is ink on paper. Color appears only to communicate severity, pass/fail, or the single highlighter accent. If something is colorful, it must mean something.
2. **Editorial confidence, technical honesty.** A refined serif for big statements, a clean sans for reading, a monospace for evidence. It should look like a well-designed field manual.
3. **Reassuring, never scary.** Founders are nervous. Use plain language, measured tone, and clear next steps. No red-alert theatrics, no skulls, no hacker clichés.

Anti-goals (do NOT use): purple/blue gradients, glassmorphism, neon glows, stock photos, emoji as icons, generic 3D blobs, unmodified default shadcn styling, "hacker green on black" terminals.

### 11.2 Design tokens (Tailwind v4 `@theme` in `app/globals.css`)

Define as CSS variables and map to Tailwind tokens. Provide light and dark values. Use `next-themes` with `class` strategy and respect `prefers-color-scheme` by default.

| Token | Light ("Paper") | Dark ("Night ops") | Use |
|---|---|---|---|
| `--bg` | `#F7F4ED` | `#0F100D` | Page background |
| `--surface` | `#FCFBF7` | `#171813` | Cards, panels |
| `--surface-2` | `#EFEBE0` | `#1F201A` | Inset areas, code blocks |
| `--border` | `#DAD5C7` | `#2B2C24` | Hairlines (1px) |
| `--ink` | `#16150F` | `#F1EEE4` | Primary text, primary buttons |
| `--ink-muted` | `#5C584D` | `#A8A497` | Secondary text |
| `--highlight` | `#FFD84D` | `#FFD84D` | Marker highlight behind key words (text on it is always dark ink) |
| `--pass` | `#1A7F4B` | `#4ADE9A` | Passed checks, "Looks good" |
| `--critical` | `#C0261B` | `#FF7B72` | Critical severity |
| `--high` | `#C2570C` | `#FF9F5A` | High severity |
| `--medium` | `#A16207` | `#F2C14E` | Medium severity |
| `--low` | `#2B5FD9` | `#7AA2FF` | Low severity |
| `--info` | `#6B6B62` | `#9A9A90` | Info |
| `--focus` | `#16150F` | `#F1EEE4` | 2px focus ring with 2px offset |

Rules:
- Severity badges use a ~10% tint of the severity color as background, the full color as text/border, **plus an icon and a text label** (color is never the only signal). Verify every text/background pair meets **WCAG AA (4.5:1)**; adjust the hex values if any pair fails.
- Primary buttons are **solid ink with paper-colored text** (inverted in dark mode). No colored brand button.
- The `--highlight` accent is used sparingly: one or two key words in the hero headline, selected states, and the score summary underline. Never as large background fills.

### 11.3 Typography (all free, via `next/font/google`)

| Role | Font | Notes |
|---|---|---|
| Display / headlines | **Instrument Serif** | Large, tight tracking, used for H1/H2 and the score number |
| UI and body | **Geist Sans** (or Inter if Geist is unavailable) | 16px base, 1.6 line height |
| Evidence, URLs, code | **Geist Mono** (or JetBrains Mono) | Findings evidence, file paths, headers |

- Type scale (rem): 0.8125, 0.875, 1, 1.125, 1.5, 2, 3, 4.5 (hero). Fluid sizing with `clamp()` for H1.
- Max reading width: 68ch for explanations. Numbers in tables and scores use `font-variant-numeric: tabular-nums`.
- Use `font-display: swap`. Load at most 3 families and 4 weights total.

### 11.4 Layout, shape, and texture

- 12-column grid, max content width 1120px, generous whitespace (section padding `py-24` desktop, `py-14` mobile).
- Spacing on an 4px base. Radius: **6px** for inputs/buttons/cards, 999px only for badges. Crisp, not bubbly.
- Depth comes from **1px hairline borders and tonal surfaces**, not drop shadows. A single soft shadow is allowed only on popovers and dialogs.
- Subtle paper texture: a tiny SVG noise overlay at 3 to 4% opacity on `--bg` (inline data URI, no image files). Disable in `prefers-reduced-data` or when it harms performance.
- Section dividers are thin rules with small mono labels (for example `01 / WHAT WE CHECK`), echoing checklist numbering.

### 11.5 Signature components

1. **Scan bar (hero input).** One long input with a mono placeholder (`https://your-app.com`), a segmented toggle for `Site | Repo | Both`, and an ink "Run pre-flight" button. Includes the ownership checkbox below, styled as a small checklist item.
2. **Pre-flight sequence (progress).** A vertical checklist where each step (`Queued`, `Fetching site`, `Scanning bundles`, `Reading repo`, `Scoring`, `Writing explanations`) shows an empty box, a spinner, then a drawn checkmark. A mono "T+00:12" elapsed timer runs beside it. Steps animate in sequence.
3. **Score dial.** A semicircular gauge drawn in SVG (altimeter feel): thin ticks, a needle that sweeps to the score, the number in Instrument Serif at large size, and the grade label ("Needs attention") underneath with a highlighter underline. Provide a text equivalent for screen readers (`role="img"` with `aria-label`).
4. **Severity strip.** A row of five count tiles (Critical to Info). Tiles are filterable toggles with `aria-pressed`.
5. **Finding card.** Left edge: 3px severity bar. Header: severity badge, plain-English title, effort chip (`5 min`, `1 hour`). Expandable body with three labeled parts: **Why it matters**, **How to fix**, **Evidence** (mono block, redacted values, copy button). Low-confidence findings show a "Potential issue" tag.
6. **Locked finding state (free summary).** Titles visible, body blurred with a clear "Unlock full report" panel. Blur is visual only: locked text must never be present in the DOM or network response.
7. **Report header.** Domain in mono, scan timestamp, score dial, severity strip, and primary actions (`Download PDF`, `Re-scan`, `Share link` disabled in v1).
8. **Empty and error states.** Friendly, specific copy with a clear next action (for example: "We couldn't reach that site. Check the URL and try again.").

### 11.6 Page specs

- **Landing (`/`)**: Hero (serif headline such as "Is your AI-built app ready to launch?" with "ready" highlighted, subhead, scan bar, small trust line "Passive checks only. We never touch your data.") then `01 / WHAT WE CHECK` grid (8 cards, mono labels), `02 / SAMPLE REPORT` interactive preview using fixture data, `03 / HOW IT WORKS` (3 steps), `04 / PRICING` (Free summary, Full report), FAQ accordion, footer with `/bot`, `/privacy`, `/terms`.
- **Scan (`/scan/[id]`)**: pre-flight sequence while running; then report (summary if locked, full if unlocked).
- **Dashboard (`/dashboard`)**: a clean table of scans (domain, date, score, grade, status) with sortable columns and row actions. Empty state invites a first scan.
- **Pricing (`/pricing`)**: two columns plus a "Coming soon" card for subscriptions. No dark patterns.

### 11.7 Motion

- Library: **Motion** (`motion/react`) or CSS only. Keep total animation JS small.
- Allowed: checklist step reveals, needle sweep (700ms ease-out), accordion expand, subtle button press (scale 0.98), page fade-in (150ms).
- Everything respects `prefers-reduced-motion: reduce` (replace with instant state changes).
- No parallax, no scroll-jacking, no looping decorative animation.

### 11.8 Voice and microcopy

- Plain, calm, specific. Short sentences. Active voice.
- Say "potential issue", never "vulnerable" or "hacked". Never say "secure" or "safe".
- Buttons are verbs: "Run pre-flight", "Unlock full report", "Download PDF".
- Each finding ends with one concrete next step.

### 11.9 Imagery and icons

- No photography or illustration files. Visuals are CSS, inline SVG, and the generated Open Graph image.
- Icons: **lucide-react** at 1.5px stroke, 16 or 20px, always paired with text for severity.
- Open Graph image generated with `next/og` using the same fonts and tokens, showing domain-agnostic branding.

### 11.10 Responsive, accessibility, performance

- Fully responsive (test at 375px, 768px, 1280px). Scan bar stacks vertically on mobile. Findings list is single column on mobile.
- Keyboard navigable, semantic HTML, visible 2px focus ring, WCAG AA contrast, touch targets at least 44px, `aria-live="polite"` for progress updates.
- Run `axe` checks in Playwright on landing, scan, and report pages. Zero serious or critical violations.
- Performance budget on landing: LCP under 2.0s on a mid-range mobile profile, total JS under 170 KB gzip, no layout shift from fonts (use `next/font` size adjust).
- Use `loading.tsx`, `error.tsx`, `not-found.tsx`, and skeleton components that match final layout.
- SEO: metadata API, Open Graph image, sitemap, robots.txt.

---

## 12. Pricing (placeholder, configurable via env)

- Free: 1 summary scan per day (anonymous or signed in).
- Full report: one-time **$9** per scan via Stripe Checkout.
- First full report free for new signed-in users (one credit), tracked in DB.
- Subscription tier is **out of scope** for v1; leave a "Coming soon" card.

---

## 13. Project structure

```
/app
  (marketing)/page.tsx, pricing/, bot/, privacy/, terms/
  (app)/dashboard/, scan/[id]/
  api/scans/, api/checkout/, api/webhooks/stripe/, api/inngest/
/components
  ui/ (shadcn), scan-form.tsx, score-gauge.tsx, finding-card.tsx, severity-badge.tsx
/lib
  db/ (schema.ts, index.ts), auth.ts, stripe.ts, ratelimit.ts, scoring.ts
  scanner/
    index.ts, types.ts, context.ts
    safe-fetch.ts          # SSRF-safe fetch wrapper
    checks/site/*.ts
    checks/repo/*.ts
    patterns/secrets.ts
  ai/ (explain.ts, prompts.ts, fallbacks.ts)
  pdf/ (report-document.tsx)
  inngest/ (client.ts, functions.ts)
/fixtures                  # sample HTML, bundles, repos for tests
/tests (unit/, e2e/)
/docs (DECISIONS.md, ARCHITECTURE.md)
.env.example
.github/workflows/ci.yml
README.md
SPEC.md
```

---

## 14. Phases and acceptance criteria

Complete one phase at a time. Open a PR per phase. CI must be green before moving on. Stop and summarize at the end of each phase.

### Phase 0: Foundation
- Next.js + TS strict + Tailwind v4 + shadcn/ui + Biome + Vitest + Playwright configured.
- Neon DB + Drizzle schema + first migration. `.env.example`. CI workflow. Deployed to Vercel preview.
- **Done when:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass in CI and the home page renders on the preview URL.

### Phase 1: Safe fetching and scan shell (split into two sessions)

Run 1A and 1B as separate agent sessions and separate PRs. Merge 1A and review it by hand before starting 1B.

#### Phase 1A: SSRF-safe fetch layer (no UI, no API, no database changes)
- `lib/scanner/safe-fetch.ts` (and `url-validation.ts` if cleaner) implementing every rule in section 7.1: `validateTargetUrl`, `isBlockedIp`, and `safeFetch` with connection-time DNS validation, manual redirects, timeout, streamed size limit, and safe error codes.
- Unit tests using local servers and mocked DNS. Every "blocked" test has an "allowed" counterpart. Cover: bad schemes, credentials, bad ports, IP literals in all forms, localhost and `.local` names, the app's own host, every blocked range, IPv4-mapped IPv6, mixed public/private DNS answers, DNS rebinding, redirects to private targets, more than 3 redirects, timeout, oversized body, and no cookies or auth headers sent.
- **Done when:** lint, typecheck, test, and build pass, and a human has reviewed `safe-fetch.ts` against the checklist in section 7.1.

#### Phase 1B: Scan form, API, rate limiting, pipeline skeleton, progress page
- Shared Zod schemas in `lib/scanner/validation.ts` (site URL via `validateTargetUrl`; repo URL strictly `https://github.com/<owner>/<repo>`; mode `site|repo|both`; `acceptedOwnership` must be `true`).
- `POST /api/scans`: validate, rate limit, create a `scans` row (`queued`), set an httpOnly, SameSite=Lax cookie (Secure in production) holding a random 32-byte token whose SHA-256 hash is stored in `anon_token_hash`, send Inngest event `scan/requested`, return `{ id }`. Generic error messages only.
- `GET /api/scans/[id]`: returns `{ id, status, step, mode, createdAt, completedAt }` only to the holder of the matching cookie; otherwise 404. From Phase 2A it also returns, once completed, `counts` (findings per severity) and `topFindings` (up to 3 `{ severity, title }`, highest severity first, titles only). Evidence, locations, and explanations are never returned before the paid unlock (Phase 5).
- `lib/ratelimit.ts` with Upstash sliding window per section 7.2, plus unit tests.
- Inngest function `scan.run` with steps `validate-and-resolve`, `mark-running`, `finalize`, updating `scans.step`. No checks yet. Serve at `/api/inngest`. New Drizzle migration for the `step` and `anon_token_hash` columns.
- UI: landing hero and scan bar (section 11.5 and 11.6), and `/scan/[id]` with TanStack Query polling every 2s and the pre-flight sequence (reduced-motion aware, `aria-live="polite"`).
- Tests: validation schemas, rate limiter, and the `POST /api/scans` handler (valid, invalid, missing ownership, rate-limited, cookie set) with DB and Inngest mocked; one Playwright test (not in CI).
- **Done when:** submitting a URL creates a scan row, the Inngest function runs, the status moves queued, running, completed, and the progress page shows it. Manual test: bad inputs (`http://localhost`, `http://169.254.169.254`, `ftp://x.com`, unchecked ownership, four fast submissions) are rejected.

### Phase 2: Site checks (split into three sessions)

Run 2A, 2B, 2C as separate agent sessions and separate PRs, in order.

#### Phase 2A: check framework, site snapshot, persistence (one exemplar check)
- `lib/scanner/types.ts` (`Check`, `RawFinding`, `ScanContext`, `SiteSnapshot`), `lib/scanner/registry.ts`, `lib/scanner/runner.ts` (runs checks in parallel with a 5s per-check timeout, isolates errors as `check_errored` info findings, and never throws).
- `lib/scanner/redact.ts` (first 4 and last 2 characters kept, rest masked) with tests.
- `lib/scanner/robots.ts` minimal robots.txt parser (no new dependency) with tests.
- `lib/scanner/snapshot.ts` building the `SiteSnapshot` through the injected fetcher under the budgets in 4.3.
- Findings persistence (idempotent) and the `scan-site` pipeline step; update `lib/scanner/steps.ts` and its tests.
- `GET /api/scans/[id]` returns `counts` and `topFindings`; the completed page shows them with a note that the full report arrives later.
- Exemplar check `site.headers.hsts`, plus `tests/helpers/fixture-server.ts` (local server with a test fetcher) and `/fixtures/vulnerable-site` and `/fixtures/clean-site`.
- **Done when:** a site-only scan produces persisted findings through the real pipeline; repo-only scans skip the new step; unit tests pass.

#### Phase 2B: header, transport, and cookie checks
- `site.headers.csp`, `site.headers.frame`, `site.headers.misc`, `site.https.redirect` (uses `ctx.fetch` on the `http://` URL and inspects `finalUrl`, no change to safe-fetch), `site.cookies`.
- Positive and negative fixtures for each.
- **Done when:** the vulnerable fixture yields the expected findings for these checks and the clean fixture yields none of them.

#### Phase 2C: bundle secrets, backend detection, performance
- `lib/scanner/patterns/secrets.ts` (shared later by repo checks), `site.bundle.secrets`, `site.backend.supabase` (decode JWT payload; `service_role` is critical, `anon` is info), `site.backend.firebase`, `site.perf.basic`.
- Integration tests: scanning `/fixtures/vulnerable-site` yields the expected set of findings; scanning `/fixtures/clean-site` yields few or none.
- **Done when:** the integration tests pass and a real scan of a known site through the UI shows counts and top titles.

### Phase 3: Repo checks
- Octokit tree fetch with caps (max 300 files, 200 KB per file, skip binaries/`node_modules`/lockfile content for secret scan).
- Implement checks in 4.2 with fixtures (small sample repos as directories).
- **Done when:** a sample repo containing a committed `.env`, a fake Stripe key, and an unverified webhook handler yields critical/high findings; a clean sample repo yields none of those.

### Phase 4: Scoring and AI explanations
- `scoring.ts` with tests. AI explain layer with Zod validation, retry, and fallback templates. Token tracking.
- Report page: score gauge, severity counts, findings list.
- **Done when:** a completed scan shows a score, grade, and explained findings. With the AI key removed or the daily AI limit exceeded, the fallback templates still render a complete report, and a simulated 429 from the AI provider triggers backoff then fallback.

### Phase 5: Auth, payments, gating
- Better Auth (magic link + GitHub). Dashboard. Summary vs full-report gating enforced **server-side**.
- Stripe Checkout + idempotent webhook + free first credit.
- **Done when:** a new user can sign in, use the free credit, and unlock a full report; a second scan prompts for payment; Stripe test-mode payment unlocks it; replayed webhooks do not double-credit.

### Phase 6: PDF, email, polish
- PDF export with `@react-pdf/renderer`. Email via Resend free plan (optional, must degrade gracefully when the key is missing or the daily cap is hit). Booking CTA. Dark mode, SEO metadata, OG image, `/bot`, `/privacy`, `/terms`.
- Sentry configured. Lighthouse 90+ on landing page (performance, accessibility, SEO, best practices).
- **Done when:** the PDF downloads and matches the on-screen report; LaunchCheck scores 90+ when scanned by itself.

### Phase 7: Documentation and demo
- README with: what it is, screenshots, architecture diagram (Mermaid), setup steps, env variable table, how to add a new check, limitations, roadmap.
- `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`.
- Playwright e2e covering: scan, sign in, unlock (Stripe test mode mocked or test keys), PDF download.
- **Done when:** a new developer can clone, follow the README, and run the app locally in under 15 minutes.

---

## 15. Testing requirements

- Unit tests for every check, `scoring.ts`, `safe-fetch.ts`, and secret redaction. Target 80%+ coverage on `/lib/scanner` and `/lib/scoring.ts`.
- Integration tests for `POST /api/scans` (validation, rate limit, enqueue) and the Stripe webhook (signature, idempotency).
- At least 3 Playwright e2e tests (anonymous scan, authenticated unlock, PDF download).
- Never hit real third-party sites in automated tests. Use fixtures and local servers (`msw` for HTTP mocking).

---

## 16. Environment variables (document all in `.env.example`)

### 16.1 Free tools that need keys

Create these accounts (all free) and give Devin the values when it asks. Never commit keys. Needed-by tells you when to have each ready.

| # | Service | Variables | Where to get it | Free plan | Needed by |
|---|---|---|---|---|---|
| 1 | **Neon** (Postgres) | `DATABASE_URL` | neon.tech, create a project, copy the **pooled** connection string | Free | Phase 0 |
| 2 | **GitHub OAuth App** (sign-in) | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub, Settings, Developer settings, OAuth Apps, New. Callback: `{APP_URL}/api/auth/callback/github` | Free | Phase 5 |
| 3 | **GitHub token** (repo scanning rate limits) | `GITHUB_TOKEN` | GitHub, Settings, Developer settings, Personal access tokens. Public-repo read-only, no extra scopes | Free | Phase 3 (optional) |
| 4 | **Upstash Redis** (rate limits, AI budget) | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | upstash.com, create a Redis database, copy REST credentials | Free | Phase 1 |
| 5 | **Inngest** (background jobs) | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | inngest.com, create an app, copy keys. Local dev uses the Inngest Dev Server and needs no keys | Free | Phase 1 (prod only) |
| 6 | **Google AI Studio** (Gemini) | `GOOGLE_GENERATIVE_AI_API_KEY` | aistudio.google.com, "Get API key" | Free tier | Phase 4 |
| 7 | **Stripe** (test mode) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_FULL_REPORT` | Stripe Dashboard in **Test mode**: API keys; create a $9 one-time product for the price id; for local webhooks run `stripe listen` (Stripe CLI) to get the `whsec_` secret, and add a webhook endpoint for production | No monthly fee, test mode free | Phase 5 |
| 8 | **Resend** (email, optional) | `RESEND_API_KEY`, `EMAIL_FROM` | resend.com, create an API key. Without a verified domain use `onboarding@resend.dev` (sends only to your own address) | Free plan | Phase 6 (optional) |
| 9 | **Sentry** (error tracking) | `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` | sentry.io, create a Next.js project, copy the DSN; create an auth token for source maps | Free (Developer) | Phase 6 (optional) |
| 10 | **Vercel** (hosting) | none in code; add all variables above in Project Settings | vercel.com, import the GitHub repo | Hobby (non-commercial) | Phase 0 |

No key needed: **OSV.dev** (dependency vulnerability API), **Google Fonts** via `next/font`, **lucide-react**, **GitHub Actions** (uses repo secrets only for CI e2e if needed).

Generated by you, no signup: `BETTER_AUTH_SECRET` (run `openssl rand -base64 32`).

### 16.2 `.env.example`

```
# --- Core / app ---
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_BOOKING_URL=        # your Calendly/Cal.com link (Cal.com has a free plan)
BETTER_AUTH_SECRET=             # generate: openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:3000

# --- Database (Neon, free) ---
DATABASE_URL=

# --- Auth: GitHub OAuth (free) ---
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_TOKEN=                   # optional, raises GitHub API rate limits for repo scans

# --- AI (Google AI Studio, free tier) ---
GOOGLE_GENERATIVE_AI_API_KEY=
AI_MODEL=                       # a free-tier Gemini Flash/Flash-Lite model id from AI Studio
AI_DAILY_CALL_LIMIT=200

# --- Rate limiting (Upstash, free) ---
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# --- Background jobs (Inngest, free; not needed locally) ---
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# --- Payments (Stripe TEST mode only) ---
STRIPE_SECRET_KEY=              # sk_test_...
STRIPE_WEBHOOK_SECRET=          # whsec_... from `stripe listen` or dashboard endpoint
STRIPE_PRICE_ID_FULL_REPORT=    # price_... (test mode, $9 one-time)

# --- Email (Resend, free, optional: disabled gracefully if empty) ---
RESEND_API_KEY=
EMAIL_FROM=

# --- Monitoring (Sentry, free, optional) ---
SENTRY_DSN=
SENTRY_AUTH_TOKEN=
```

### 16.3 Rules

- Validate with Zod in `lib/env.ts`. **Required** at startup: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`. Others are required only when their feature is enabled (for example Stripe vars in Phase 5), and the app must disable that feature gracefully if they are absent.
- If a required key is missing, fail with a clear startup error naming the variable.
- Only variables prefixed `NEXT_PUBLIC_` may reach the browser. Never expose any secret to the client.
- Ask the human for credentials; never invent or commit them. Keep `.env.local` out of git and keep `.env.example` current.

---

## 17. Working agreements for the agent

- Small, focused commits using Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- One PR per phase, with a description listing what was built and how to verify it.
- Prefer boring, well-documented libraries. Do not add dependencies outside section 2 without recording why in `docs/DECISIONS.md`.
- No `TODO` left in merged code without a linked issue.
- Never log secrets or full user-submitted source code.
- When blocked on credentials or an external account, stop and list exactly what you need, then continue with mocks where possible.
- At the end of each phase, output: what was done, what was tested, known limitations, next phase.

---

## 18. Definition of done (whole project)

- [ ] All phases complete, CI green, deployed on Vercel.
- [ ] Scanner passes all fixture tests; SSRF tests pass.
- [ ] Free summary, paid full report, and PDF export all work end to end in Stripe test mode.
- [ ] LaunchCheck scans itself with a 90+ score.
- [ ] README includes screenshots, architecture diagram, and a 2-minute demo video link.
- [ ] Limitations and "potential issues only" disclaimers are visible in the UI and README.
