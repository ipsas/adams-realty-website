CREATE TYPE "public"."alert_frequency" AS ENUM('instant', 'daily', 'weekly', 'off');--> statement-breakpoint
CREATE TYPE "public"."data_source_kind" AS ENUM('manual', 'reso_web_api');--> statement-breakpoint
CREATE TYPE "public"."inquiry_status" AS ENUM('new', 'contacted', 'qualified', 'closed', 'spam');--> statement-breakpoint
CREATE TYPE "public"."inquiry_type" AS ENUM('question', 'tour', 'offer', 'valuation', 'general');--> statement-breakpoint
CREATE TYPE "public"."listing_event_type" AS ENUM('listed', 'price_change', 'status_change', 'sold', 'relisted', 'removed');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('coming_soon', 'active', 'active_under_contract', 'pending', 'closed', 'withdrawn', 'expired', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('photo', 'floor_plan', 'video', 'virtual_tour');--> statement-breakpoint
CREATE TYPE "public"."open_house_type" AS ENUM('in_person', 'virtual');--> statement-breakpoint
CREATE TYPE "public"."property_type" AS ENUM('single_family', 'condo', 'townhouse', 'multi_family', 'manufactured', 'land', 'farm_ranch', 'other');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tour_type" AS ENUM('in_person', 'video');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('sale', 'rent');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'agent', 'admin');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"office_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"email" text NOT NULL,
	"phone" text,
	"bio" text,
	"photo_url" text,
	"license_number" text,
	"mls_agent_id" text,
	"specialties" text[] DEFAULT '{}' NOT NULL,
	"languages" text[] DEFAULT '{}' NOT NULL,
	"service_areas" text[] DEFAULT '{}' NOT NULL,
	"years_experience" smallint,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "agents_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "offices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"address_line1" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"mls_office_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offices_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" "data_source_kind" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"disclaimer" text,
	"sync_cursor" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_sources_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "listing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"type" "listing_event_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"price" integer,
	"previous_price" integer,
	"from_status" "listing_status",
	"to_status" "listing_status"
);
--> statement-breakpoint
CREATE TABLE "listing_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"kind" "media_kind" DEFAULT 'photo' NOT NULL,
	"url" text NOT NULL,
	"caption" text,
	"width" integer,
	"height" integer,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"source_key" text
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"listing_key" text NOT NULL,
	"mls_number" text,
	"slug" text NOT NULL,
	"status" "listing_status" NOT NULL,
	"transaction_type" "transaction_type" DEFAULT 'sale' NOT NULL,
	"property_type" "property_type" NOT NULL,
	"property_sub_type" text,
	"list_price" integer NOT NULL,
	"original_list_price" integer,
	"close_price" integer,
	"list_date" date,
	"close_date" date,
	"bedrooms" smallint,
	"bathrooms_full" smallint,
	"bathrooms_half" smallint,
	"bathrooms" real,
	"living_area_sqft" integer,
	"lot_size_sqft" integer,
	"year_built" smallint,
	"stories" smallint,
	"garage_spaces" smallint,
	"hoa_fee" integer,
	"hoa_frequency" text,
	"tax_annual_amount" integer,
	"tax_year" smallint,
	"address_line1" text NOT NULL,
	"unit_number" text,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"postal_code" text NOT NULL,
	"county" text,
	"neighborhood" text,
	"latitude" double precision,
	"longitude" double precision,
	"hide_address" boolean DEFAULT false NOT NULL,
	"headline" text,
	"description" text,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schools" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"has_pool" boolean DEFAULT false NOT NULL,
	"is_waterfront" boolean DEFAULT false NOT NULL,
	"has_view" boolean DEFAULT false NOT NULL,
	"has_basement" boolean DEFAULT false NOT NULL,
	"is_new_construction" boolean DEFAULT false NOT NULL,
	"is_single_story" boolean DEFAULT false NOT NULL,
	"virtual_tour_url" text,
	"video_url" text,
	"primary_photo_url" text,
	"photo_count" smallint DEFAULT 0 NOT NULL,
	"list_agent_id" uuid,
	"list_agent_name" text,
	"list_agent_phone" text,
	"list_agent_email" text,
	"list_office_name" text,
	"list_office_mls_id" text,
	"is_company_listing" boolean DEFAULT false NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"source_modified_at" timestamp with time zone,
	"status_changed_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (
        setweight(to_tsvector('english',
          coalesce("listings"."address_line1", '') || ' ' || coalesce("listings"."city", '') || ' ' ||
          coalesce("listings"."postal_code", '') || ' ' || coalesce("listings"."neighborhood", '') || ' ' ||
          coalesce("listings"."mls_number", '')), 'A') ||
        setweight(to_tsvector('english',
          coalesce("listings"."headline", '') || ' ' || coalesce("listings"."property_sub_type", '')), 'B') ||
        setweight(to_tsvector('english', coalesce("listings"."description", '')), 'C')) STORED,
	CONSTRAINT "listings_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "open_houses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"type" "open_house_type" DEFAULT 'in_person' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"remarks" text,
	"source_key" text
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"status" "sync_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"fetched" integer DEFAULT 0 NOT NULL,
	"upserted" integer DEFAULT 0 NOT NULL,
	"removed" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"changes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "inquiry_type" NOT NULL,
	"status" "inquiry_status" DEFAULT 'new' NOT NULL,
	"listing_id" uuid,
	"agent_id" uuid,
	"user_id" text,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"message" text,
	"tour_at" timestamp with time zone,
	"tour_type" "tour_type",
	"source" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_listings" (
	"user_id" text NOT NULL,
	"listing_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_listings_user_id_listing_id_pk" PRIMARY KEY("user_id","listing_id")
);
--> statement-breakpoint
CREATE TABLE "saved_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"alert_frequency" "alert_frequency" DEFAULT 'daily' NOT NULL,
	"last_alerted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_events" ADD CONSTRAINT "listing_events_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_media" ADD CONSTRAINT "listing_media_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_list_agent_id_agents_id_fk" FOREIGN KEY ("list_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_houses" ADD CONSTRAINT "open_houses_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_listings" ADD CONSTRAINT "saved_listings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_listings" ADD CONSTRAINT "saved_listings_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "agents_mls_agent_idx" ON "agents" USING btree ("mls_agent_id");--> statement-breakpoint
CREATE INDEX "listing_events_listing_idx" ON "listing_events" USING btree ("listing_id","occurred_at");--> statement-breakpoint
CREATE INDEX "listing_media_listing_idx" ON "listing_media" USING btree ("listing_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_source_key_idx" ON "listings" USING btree ("source_id","listing_key");--> statement-breakpoint
CREATE INDEX "listings_status_price_idx" ON "listings" USING btree ("status","list_price");--> statement-breakpoint
CREATE INDEX "listings_city_idx" ON "listings" USING btree ("city");--> statement-breakpoint
CREATE INDEX "listings_postal_code_idx" ON "listings" USING btree ("postal_code");--> statement-breakpoint
CREATE INDEX "listings_list_agent_idx" ON "listings" USING btree ("list_agent_id");--> statement-breakpoint
CREATE INDEX "listings_updated_idx" ON "listings" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "listings_geo_idx" ON "listings" USING gist (point("longitude", "latitude"));--> statement-breakpoint
CREATE INDEX "listings_search_idx" ON "listings" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "listings_address_trgm_idx" ON "listings" USING gin ("address_line1" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "open_houses_listing_idx" ON "open_houses" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "open_houses_starts_idx" ON "open_houses" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "sync_runs_source_idx" ON "sync_runs" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "inquiries_agent_status_idx" ON "inquiries" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "inquiries_created_idx" ON "inquiries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "inquiries_listing_idx" ON "inquiries" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "saved_listings_listing_idx" ON "saved_listings" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "saved_searches_user_idx" ON "saved_searches" USING btree ("user_id");