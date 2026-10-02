-- No write path for overrides existed: any row was written by hand and has no outlet to inherit.
DELETE FROM "user_permissions";--> statement-breakpoint
-- Staff who held auditor keep their role: it is renamed to the PRD's accountant, not replaced.
UPDATE "roles" SET "name" = 'accountant' WHERE "name" = 'auditor'
  AND NOT EXISTS (SELECT 1 FROM "roles" WHERE "name" = 'accountant');--> statement-breakpoint
ALTER TABLE "user_permissions" DROP CONSTRAINT "user_permissions_user_id_permission_id_pk";--> statement-breakpoint
ALTER TABLE "user_permissions" ADD COLUMN "outlet_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "is_global" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "editable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_outlet_id_permission_id_pk" PRIMARY KEY("user_id","outlet_id","permission_id");--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The seed sets these too; doing it here closes the window between migrate and seed, when every
-- existing role would read as an editable custom role and owner as assignable.
UPDATE "roles" SET "is_global" = true, "editable" = false WHERE "name" = 'owner';--> statement-breakpoint
UPDATE "roles" SET "editable" = false WHERE "name" IN ('manager', 'supervisor', 'cashier', 'waiter', 'kitchen', 'accountant');
