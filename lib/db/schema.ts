import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const scanStatusEnum = pgEnum("scan_status", ["queued", "running", "completed", "failed"]);

export const findingCategoryEnum = pgEnum("finding_category", [
  "security",
  "secrets",
  "performance",
  "reliability",
]);

export const findingSeverityEnum = pgEnum("finding_severity", [
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);

export const findingConfidenceEnum = pgEnum("finding_confidence", ["high", "medium", "low"]);

export const findingEffortEnum = pgEnum("finding_effort", ["low", "medium", "high"]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "completed",
  "failed",
  "refunded",
]);

export const scans = pgTable(
  "scans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id"),
    anonToken: text("anon_token"),
    siteUrl: text("site_url"),
    repoUrl: text("repo_url"),
    status: scanStatusEnum("status").notNull().default("queued"),
    score: integer("score"),
    grade: text("grade"),
    unlocked: boolean("unlocked").notNull().default(false),
    error: text("error"),
    aiInputTokens: integer("ai_input_tokens"),
    aiOutputTokens: integer("ai_output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("scans_user_id_created_at_idx").on(table.userId, table.createdAt)],
);

export const findings = pgTable(
  "findings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    checkId: text("check_id").notNull(),
    category: findingCategoryEnum("category").notNull(),
    severity: findingSeverityEnum("severity").notNull(),
    confidence: findingConfidenceEnum("confidence").notNull(),
    title: text("title").notNull(),
    evidenceRedacted: text("evidence_redacted").notNull(),
    location: text("location"),
    plainTitle: text("plain_title"),
    whyItMatters: text("why_it_matters"),
    suggestedFix: text("suggested_fix"),
    effort: findingEffortEnum("effort"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("findings_scan_id_idx").on(table.scanId)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Auth tables land in Phase 5; keep user_id without a FK until then.
    userId: uuid("user_id").notNull(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    stripeSessionId: text("stripe_session_id").notNull().unique(),
    stripePaymentIntent: text("stripe_payment_intent"),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("usd"),
    status: paymentStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("payments_stripe_session_id_idx").on(table.stripeSessionId)],
);
