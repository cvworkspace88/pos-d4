ALTER TABLE "users" ADD COLUMN "password_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_window_started_at" timestamp with time zone;