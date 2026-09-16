CREATE TABLE "outlet_staff" (
	"outlet_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "outlet_staff_outlet_id_user_id_pk" PRIMARY KEY("outlet_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "outlets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"address" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "outlet_staff" ADD CONSTRAINT "outlet_staff_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet_staff" ADD CONSTRAINT "outlet_staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outlet_staff_user_id_idx" ON "outlet_staff" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outlets_name_active_idx" ON "outlets" USING btree ("name") WHERE "outlets"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "outlets_code_active_idx" ON "outlets" USING btree ("code") WHERE "outlets"."deleted_at" IS NULL;