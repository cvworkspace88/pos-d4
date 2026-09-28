CREATE TABLE "addon_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"min_select" integer NOT NULL,
	"max_select" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "addon_groups_min" CHECK ("addon_groups"."min_select" >= 0),
	CONSTRAINT "addon_groups_max" CHECK ("addon_groups"."max_select" >= 1),
	CONSTRAINT "addon_groups_min_max" CHECK ("addon_groups"."min_select" <= "addon_groups"."max_select")
);
--> statement-breakpoint
CREATE TABLE "addon_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price" integer NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "addon_options_price" CHECK ("addon_options"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "menu_item_addon_groups" (
	"menu_item_id" uuid NOT NULL,
	"addon_group_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "menu_item_addon_groups_menu_item_id_addon_group_id_pk" PRIMARY KEY("menu_item_id","addon_group_id")
);
--> statement-breakpoint
CREATE TABLE "menu_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price" integer NOT NULL,
	"cost" integer,
	"available" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "menu_variants_price" CHECK ("menu_variants"."price" >= 0),
	CONSTRAINT "menu_variants_cost" CHECK ("menu_variants"."cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "addon_groups" ADD CONSTRAINT "addon_groups_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addon_options" ADD CONSTRAINT "addon_options_group_id_addon_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."addon_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_addon_groups" ADD CONSTRAINT "menu_item_addon_groups_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_addon_groups" ADD CONSTRAINT "menu_item_addon_groups_addon_group_id_addon_groups_id_fk" FOREIGN KEY ("addon_group_id") REFERENCES "public"."addon_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_variants" ADD CONSTRAINT "menu_variants_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "addon_groups_outlet_name_active_idx" ON "addon_groups" USING btree ("outlet_id","name") WHERE "addon_groups"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "addon_options_group_name_active_idx" ON "addon_options" USING btree ("group_id","name") WHERE "addon_options"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "menu_item_addon_groups_group_idx" ON "menu_item_addon_groups" USING btree ("addon_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_variants_item_name_active_idx" ON "menu_variants" USING btree ("menu_item_id","name") WHERE "menu_variants"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "menu_items_outlet_code_active_idx" ON "menu_items" USING btree ("outlet_id","code") WHERE "menu_items"."deleted_at" IS NULL AND "menu_items"."code" IS NOT NULL;