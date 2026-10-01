CREATE TABLE "kitchen_stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "kitchen_station_id" uuid;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "kitchen_name" text;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "service_charge_applies" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "kitchen_station_id" uuid;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "sold_by" text DEFAULT 'unit' NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "kitchen_stations" ADD CONSTRAINT "kitchen_stations_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kitchen_stations_outlet_name_idx" ON "kitchen_stations" USING btree ("outlet_id","name");--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_kitchen_station_id_kitchen_stations_id_fk" FOREIGN KEY ("kitchen_station_id") REFERENCES "public"."kitchen_stations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_kitchen_station_id_kitchen_stations_id_fk" FOREIGN KEY ("kitchen_station_id") REFERENCES "public"."kitchen_stations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_sold_by" CHECK ("menu_items"."sold_by" IN ('unit', 'weight'));
--> statement-breakpoint
UPDATE "menu_items" SET "active" = "available";
