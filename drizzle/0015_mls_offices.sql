CREATE TABLE "mls_offices" (
	"office_mls_id" text PRIMARY KEY NOT NULL,
	"office_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
