CREATE TABLE "phone_verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone_number" text NOT NULL,
	"code" varchar(6) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"verified_at" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "phone_verifications_phone_idx" ON "phone_verifications" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX "phone_verifications_code_idx" ON "phone_verifications" USING btree ("code");--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "start_date";