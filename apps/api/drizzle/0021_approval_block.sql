ALTER TABLE "users" ADD COLUMN "approval_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "approval_window_started_at" timestamp with time zone;