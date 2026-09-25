ALTER TABLE "outlets" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "timezone" text DEFAULT 'Asia/Jakarta' NOT NULL;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "pbjt_label" text DEFAULT 'PBJT' NOT NULL;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "pbjt_rate_bp" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "pbjt_inclusive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "service_name" text DEFAULT 'Biaya Layanan' NOT NULL;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "service_rate_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "service_pbjt_taxable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "npwp" text;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "npwpd" text;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "ppn_inclusive" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ppn_rate_bp" integer DEFAULT 1100 NOT NULL;--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_timezone" CHECK ("outlets"."timezone" IN ('Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'));--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_pbjt_rate_bp" CHECK ("outlets"."pbjt_rate_bp" BETWEEN 0 AND 10000);--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_service_rate_bp" CHECK ("outlets"."service_rate_bp" BETWEEN 0 AND 10000);--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_ppn_rate_bp" CHECK ("settings"."ppn_rate_bp" BETWEEN 0 AND 10000);