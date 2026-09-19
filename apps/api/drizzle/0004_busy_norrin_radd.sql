ALTER TABLE "outlet_staff" ADD COLUMN "role_id" uuid;--> statement-breakpoint
UPDATE "outlet_staff" s SET "role_id" = u."role_id" FROM "users" u WHERE u."id" = s."user_id" AND u."role_id" IS NOT NULL;--> statement-breakpoint
DELETE FROM "outlet_staff" WHERE "role_id" IS NULL;--> statement-breakpoint
ALTER TABLE "outlet_staff" ALTER COLUMN "role_id" SET NOT NULL;--> statement-breakpoint
UPDATE "users" SET "role_id" = NULL WHERE "role_id" IS NOT NULL AND "role_id" <> (SELECT "id" FROM "roles" WHERE "name" = 'owner');--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "outlet_id" uuid;--> statement-breakpoint
ALTER TABLE "outlet_staff" ADD CONSTRAINT "outlet_staff_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE set null ON UPDATE no action;