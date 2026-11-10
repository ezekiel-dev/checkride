# AGENTS.md

Standing instructions for any AI agent (Devin or otherwise) working in this repository. Read this file and `SPEC.md` at the start of every session. If they conflict, `SPEC.md` wins on product and architecture, and this file wins on workflow.

## Project in one line
LaunchCheck: a Next.js app that scans a live site URL and/or public GitHub repo for launch-readiness risks and produces a plain-English, severity-ranked report. It reports *potential issues only* and never claims anything is "secure".

## Stack (do not change without recording a decision)
Next.js (App Router) + TypeScript strict, Tailwind CSS v4, shadcn/ui, Drizzle ORM + Neon Postgres, Better Auth, Inngest, Upstash Redis, Vercel AI SDK with Google Gemini (free tier), Stripe (test mode), Resend (optional), `@react-pdf/renderer`, Vitest, Playwright, Biome, pnpm.

All services must stay on **free plans**. Never add a paid service or dependency that requires payment.

## Commands
```
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm db:generate    # drizzle-kit generate
pnpm db:migrate
```
If a script is missing, add it to `package.json` and document it in the README.

Before opening any PR, all of these must pass: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Workflow
- Work on **one phase at a time** from `SPEC.md` section 14. Do not start the next phase until told to.
- One branch and one PR per phase. Branch names: `phase-N-short-name`.
- Use Conventional Commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`.
- Keep commits small and focused. Do not mix refactors with features.
- PR description must include: what was built, how to verify it, tests added, known limitations.
- At the end of each phase, stop and report: what was done, what was tested, known limitations, next phase.

## Code standards
- TypeScript strict. No `any` without an explanatory comment. No `@ts-ignore` without a linked reason.
- Validate all external input with Zod (forms, API bodies, env vars, AI output, third-party responses).
- Share Zod schemas between client and server where possible.
- Prefer Server Components. Use Client Components only when interactivity requires it.
- Keep scanner checks as pure, independent modules in `lib/scanner/checks/`, each with unit tests and fixtures.
- Keep AI code behind `lib/ai/explainFindings()`. Do not leak provider-specific types elsewhere.
- Use Drizzle's query builder or parameterized SQL only. Never build SQL with string concatenation.
- Use the shadcn/ui components and Tailwind utilities. Do not add another UI library.
- Accessibility is required: semantic HTML, keyboard support, visible focus, WCAG AA contrast, and never use color alone to convey severity.
- No `TODO` in merged code unless it links to a GitHub issue.

## Security rules (non-negotiable)
- **All user-supplied URLs must go through `lib/scanner/safe-fetch.ts`.** Never call `fetch` directly on user input. This wrapper enforces the SSRF protections in `SPEC.md` section 7.
- Never log, store, or send to an LLM a full secret. Redact to first 4 and last 2 characters.
- Never send raw source files or full secrets to the AI provider. Send redacted findings only.
- Never commit secrets. Use `.env.local` for local values and keep `.env.example` up to date with every variable.
- Verify Stripe webhook signatures and keep webhook handling idempotent.
- Enforce paywall and ownership checks on the **server**, never only in the UI.
- Do not scan localhost, private IPs, or this app's own domain.
- Do not implement active exploitation, fuzzing, or port scanning. Passive checks only.

## Testing rules
- Every check, `lib/scoring.ts`, `safe-fetch.ts`, and secret redaction require unit tests with positive and negative cases.
- Automated tests must **never call real third-party sites or paid APIs**. Use fixtures, local servers, and `msw`.
- Bug fixes need a regression test.
- If a test is flaky, fix or delete it. Do not leave it skipped.

## Free-tier discipline
- Batch AI calls (one per scan). Retry with backoff on HTTP 429, then fall back to templates.
- Respect the daily AI budget counter. The app must still produce a complete report with no AI.
- Email is optional. If `RESEND_API_KEY` is missing or the cap is hit, degrade gracefully.
- Keep database rows small. Do not persist raw bundles or full file contents after a scan finishes.

## When blocked
- If you need credentials, accounts, or a decision, **stop and list exactly what you need**. Do not invent keys or values.
- Continue with mocks or fixtures where possible so work is not blocked.
- Record non-obvious choices in `docs/DECISIONS.md` (date, decision, reason).
- If something in `SPEC.md` is ambiguous, choose the simplest option, document it, and continue.

## Do not
- Add features that are not in `SPEC.md`.
- Upgrade or swap major dependencies mid-phase.
- Disable lint rules, type checks, or tests to make CI pass.
- Rewrite large areas of working code without being asked.
- Make claims of security or guarantees in any UI copy, README, or report.

## Definition of done for any task
Code is typed and linted, tests pass locally and in CI, docs and `.env.example` are updated, the change is described in the PR, and no secrets or debug logging were committed.
