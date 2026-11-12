ALTER TABLE "scans" DROP COLUMN "anon_token";--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "anon_token_hash" text;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "step" text;
