ALTER TABLE "settings" DROP CONSTRAINT "settings_ppn_rate_bp";--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "ppn_rate_bp" integer DEFAULT 1100 NOT NULL;--> statement-breakpoint
-- Every outlet starts from the deployment-wide rate it used until now.
UPDATE "outlets" SET "ppn_rate_bp" = "settings"."ppn_rate_bp" FROM "settings" WHERE "settings"."id" = 1;--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "ppn_rate_bp";--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_ppn_rate_bp" CHECK ("outlets"."ppn_rate_bp" BETWEEN 0 AND 10000);
