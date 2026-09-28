DROP INDEX "addon_options_group_name_active_idx";--> statement-breakpoint
DROP INDEX "menu_variants_item_name_active_idx";--> statement-breakpoint
CREATE INDEX "addon_options_group_idx" ON "addon_options" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "menu_variants_item_idx" ON "menu_variants" USING btree ("menu_item_id");