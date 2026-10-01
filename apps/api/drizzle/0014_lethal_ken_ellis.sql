ALTER TABLE "outlets" ADD COLUMN "service_order_types" text[] DEFAULT ARRAY['dine_in']::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "business_day_cutoff" time DEFAULT '04:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "business_day_auto_close" time;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "desktop_lock_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_service_order_types" CHECK ("outlets"."service_order_types" <@ ARRAY['dine_in', 'takeaway', 'delivery']::text[]);--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_desktop_lock_seconds" CHECK ("settings"."desktop_lock_seconds" BETWEEN 0 AND 3600);