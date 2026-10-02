DROP INDEX "tables_name_active_idx";--> statement-breakpoint
ALTER TABLE "reservations" ALTER COLUMN "id" SET DEFAULT uuidv7();--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "outlet_id" uuid;--> statement-breakpoint
ALTER TABLE "tables" ADD COLUMN "outlet_id" uuid;--> statement-breakpoint
-- Floor data predates outlet scoping: hand it to the oldest live outlet, and each reservation to its
-- table's. With no live outlet there is nobody to own it (a dev database), so it goes.
UPDATE "tables" SET "outlet_id" = (SELECT "id" FROM "outlets" WHERE "deleted_at" IS NULL ORDER BY "created_at" LIMIT 1);--> statement-breakpoint
UPDATE "reservations" r SET "outlet_id" = t."outlet_id" FROM "tables" t WHERE t."id" = r."table_id";--> statement-breakpoint
DELETE FROM "reservations" WHERE "outlet_id" IS NULL;--> statement-breakpoint
DELETE FROM "tables" WHERE "outlet_id" IS NULL;--> statement-breakpoint
ALTER TABLE "reservations" ALTER COLUMN "outlet_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tables" ALTER COLUMN "outlet_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tables" ADD CONSTRAINT "tables_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reservations_outlet_starts_idx" ON "reservations" USING btree ("outlet_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tables_outlet_name_active_idx" ON "tables" USING btree ("outlet_id","name") WHERE "tables"."deleted_at" IS NULL;