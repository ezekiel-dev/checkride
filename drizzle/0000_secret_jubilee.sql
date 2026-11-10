CREATE TYPE "public"."finding_category" AS ENUM('security', 'secrets', 'performance', 'reliability');--> statement-breakpoint
CREATE TYPE "public"."finding_confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."finding_effort" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."finding_severity" AS ENUM('critical', 'high', 'medium', 'low', 'info');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'completed', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"check_id" text NOT NULL,
	"category" "finding_category" NOT NULL,
	"severity" "finding_severity" NOT NULL,
	"confidence" "finding_confidence" NOT NULL,
	"title" text NOT NULL,
	"evidence_redacted" text NOT NULL,
	"location" text,
	"plain_title" text,
	"why_it_matters" text,
	"suggested_fix" text,
	"effort" "finding_effort",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scan_id" uuid NOT NULL,
	"stripe_session_id" text NOT NULL,
	"stripe_payment_intent" text,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_stripe_session_id_unique" UNIQUE("stripe_session_id")
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"anon_token" text,
	"site_url" text,
	"repo_url" text,
	"status" "scan_status" DEFAULT 'queued' NOT NULL,
	"score" integer,
	"grade" text,
	"unlocked" boolean DEFAULT false NOT NULL,
	"error" text,
	"ai_input_tokens" integer,
	"ai_output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "findings_scan_id_idx" ON "findings" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "payments_stripe_session_id_idx" ON "payments" USING btree ("stripe_session_id");--> statement-breakpoint
CREATE INDEX "scans_user_id_created_at_idx" ON "scans" USING btree ("user_id","created_at");