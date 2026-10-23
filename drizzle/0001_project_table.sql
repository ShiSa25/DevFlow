CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "project_name_length" CHECK (char_length("project"."name") between 1 and 100),
	CONSTRAINT "project_description_length" CHECK ("project"."description" is null or char_length("project"."description") <= 5000)
);
--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_owner_list_idx" ON "project" USING btree ("owner_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);