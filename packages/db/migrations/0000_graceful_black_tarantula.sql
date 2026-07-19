CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."contractor_document_type" AS ENUM('registration', 'insurance', 'inspection');--> statement-breakpoint
CREATE TYPE "public"."document_scan_status" AS ENUM('pending', 'clean', 'infected', 'error');--> statement-breakpoint
CREATE TYPE "public"."faq_category" AS ENUM('billing', 'routes', 'shuttle', 'account', 'corporate', 'general');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('payment_received', 'payment_failed', 'refund_completed', 'refund_failed', 'seat_claimed', 'seat_released', 'seat_release_expired', 'subscription_expiring', 'subscription_expired', 'subscription_cancelled', 'trip_departing', 'document_verified', 'document_rejected', 'support_reply', 'support_resolved', 'corporate_member_added', 'corporate_member_removed', 'corporate_reset', 'general');--> statement-breakpoint
CREATE TYPE "public"."otp_purpose" AS ENUM('signup_verification', 'password_reset', 'phone_change');--> statement-breakpoint
CREATE TYPE "public"."outbox_channel" AS ENUM('notification', 'sms', 'push', 'email', 'refund', 'audit', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."outbox_event_status" AS ENUM('pending', 'processing', 'delivered', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('telebirr', 'cbe');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'completed', 'failed', 'refunded', 'partially_refunded');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'processing', 'succeeded', 'failed', 'permanent_failure');--> statement-breakpoint
CREATE TYPE "public"."ride_status" AS ENUM('booked', 'boarded', 'completed', 'no_show', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."seat_claim_status" AS ENUM('confirmed', 'used', 'no_show', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."seat_release_status" AS ENUM('open', 'claimed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."seat_window" AS ENUM('morning', 'evening');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('pending_payment', 'active', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ticket_category" AS ENUM('general', 'billing', 'route', 'shuttle', 'account', 'corporate', 'other');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'in_progress', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('scheduled', 'in_transit', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('rider', 'contractor', 'corporate_admin', 'platform_admin');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('coaster', 'minibus', 'van', 'sedan');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('unverified', 'pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip_address" text,
	"user_agent" text,
	"prev_hash" text,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contractor_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"contractor_id" text NOT NULL,
	"type" "contractor_document_type" NOT NULL,
	"original_filename" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum_sha256" text NOT NULL,
	"scan_status" "document_scan_status" DEFAULT 'pending' NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contractor_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"license_number" text NOT NULL,
	"experience_years" integer DEFAULT 0 NOT NULL,
	"rating" real DEFAULT 5 NOT NULL,
	"verification_status" "verification_status" DEFAULT 'unverified' NOT NULL,
	"verification_reason" text,
	"verified_by_id" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contractor_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "contractor_profiles_license_number_unique" UNIQUE("license_number")
);
--> statement-breakpoint
CREATE TABLE "corporate_members" (
	"id" text PRIMARY KEY NOT NULL,
	"corporate_id" text NOT NULL,
	"user_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"approval_status" "approval_status" DEFAULT 'pending' NOT NULL,
	"rides_used_this_month" integer DEFAULT 0 NOT NULL,
	"last_reset_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporate_members_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "corporates" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text NOT NULL,
	"subsidy_percent" integer DEFAULT 50 NOT NULL,
	"monthly_seat_allowance" integer DEFAULT 20 NOT NULL,
	"admin_user_id" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporates_code_unique" UNIQUE("code"),
	CONSTRAINT "corporates_admin_user_id_unique" UNIQUE("admin_user_id"),
	CONSTRAINT "subsidy_range" CHECK ("corporates"."subsidy_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"push_token" text NOT NULL,
	"platform" text NOT NULL,
	"user_agent" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "faq_articles" (
	"id" text PRIMARY KEY NOT NULL,
	"category" "faq_category" NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"question_am" text,
	"answer_am" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"helpful_yes" integer DEFAULT 0 NOT NULL,
	"helpful_no" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"key" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"request_body_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quiet_hours_start" text,
	"quiet_hours_end" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"purpose" "otp_purpose" NOT NULL,
	"code_hash" text NOT NULL,
	"user_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" "outbox_channel" NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_event_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"visibility_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"rider_id" text NOT NULL,
	"subscription_id" text,
	"seat_claim_id" text,
	"amount" numeric(12, 2) NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text NOT NULL,
	"prepay_id" text,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"refund_amount" numeric(12, 2),
	"refunded_at" timestamp with time zone,
	"retention_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_reference_unique" UNIQUE("reference"),
	CONSTRAINT "refund_amount_lte_amount" CHECK ("payments"."refund_amount" <= "payments"."amount")
);
--> statement-breakpoint
CREATE TABLE "refund_retries" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_id" text NOT NULL,
	"merch_order_id" text NOT NULL,
	"refund_request_no" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"reason" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_retries_refund_request_no_unique" UNIQUE("refund_request_no")
);
--> statement-breakpoint
CREATE TABLE "rider_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"home_area" text NOT NULL,
	"work_area" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rider_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "rides" (
	"id" text PRIMARY KEY NOT NULL,
	"rider_id" text NOT NULL,
	"trip_id" text NOT NULL,
	"subscription_id" text,
	"seat_claim_id" text,
	"status" "ride_status" DEFAULT 'booked' NOT NULL,
	"pickup_stop" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"stops" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"polyline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin_lat_lng" jsonb NOT NULL,
	"dest_lat_lng" jsonb NOT NULL,
	"distance_km" real NOT NULL,
	"duration_min" integer NOT NULL,
	"morning_window" jsonb NOT NULL,
	"evening_window" jsonb NOT NULL,
	"fare" numeric(12, 2) NOT NULL,
	"needs_shuttle" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routes_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "seat_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"seat_release_id" text NOT NULL,
	"rider_id" text NOT NULL,
	"corporate_member_id" text,
	"route_id" text NOT NULL,
	"window" "seat_window" NOT NULL,
	"claim_date" timestamp with time zone DEFAULT now() NOT NULL,
	"payment_id" text,
	"status" "seat_claim_status" DEFAULT 'confirmed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seat_claims_seat_release_id_unique" UNIQUE("seat_release_id")
);
--> statement-breakpoint
CREATE TABLE "seat_releases" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"rider_id" text NOT NULL,
	"route_id" text NOT NULL,
	"window" "seat_window" NOT NULL,
	"release_date" date NOT NULL,
	"refund_amount" numeric(12, 2) NOT NULL,
	"status" "seat_release_status" DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"jti" text NOT NULL,
	"user_agent" text,
	"ip_address" text,
	"impersonated_by" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_jti_unique" UNIQUE("jti")
);
--> statement-breakpoint
CREATE TABLE "shuttle_positions" (
	"shuttle_id" text PRIMARY KEY NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"heading" real,
	"speed" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shuttles" (
	"id" text PRIMARY KEY NOT NULL,
	"plate_number" text NOT NULL,
	"model" text NOT NULL,
	"year" integer NOT NULL,
	"vehicle_type" "vehicle_type" NOT NULL,
	"capacity" integer DEFAULT 14 NOT NULL,
	"contractor_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shuttles_plate_number_unique" UNIQUE("plate_number")
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"duration_days" integer NOT NULL,
	"rides_included" integer NOT NULL,
	"price_etb" numeric(12, 2) NOT NULL,
	"description" text NOT NULL,
	"is_popular" boolean DEFAULT false NOT NULL,
	"is_trial" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_plans_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"rider_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"route_id" text,
	"corporate_member_id" text,
	"status" "subscription_status" DEFAULT 'pending_payment' NOT NULL,
	"rides_used" integer DEFAULT 0 NOT NULL,
	"morning_slot" text,
	"evening_slot" text,
	"start_date" timestamp with time zone DEFAULT now() NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"priority" "ticket_priority" DEFAULT 'normal' NOT NULL,
	"category" "ticket_category" DEFAULT 'general' NOT NULL,
	"user_id" text NOT NULL,
	"subscription_id" text,
	"payment_id" text,
	"assigned_to_id" text,
	"resolved_by_id" text,
	"first_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telebirr_notify_events" (
	"merch_order_id" text PRIMARY KEY NOT NULL,
	"trade_status" text NOT NULL,
	"out_request_no" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"is_staff" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tos_acceptances" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"version" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" text PRIMARY KEY NOT NULL,
	"shuttle_id" text NOT NULL,
	"contractor_id" text,
	"route_id" text NOT NULL,
	"window" "seat_window" NOT NULL,
	"depart_time" timestamp with time zone NOT NULL,
	"arrive_time" timestamp with time zone,
	"status" "trip_status" DEFAULT 'scheduled' NOT NULL,
	"seats_booked" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seats_booked_non_negative" CHECK ("trips"."seats_booked" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'rider' NOT NULL,
	"phone_verified" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"token_version" integer DEFAULT 0 NOT NULL,
	"two_factor_secret" text,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"tos_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_documents" ADD CONSTRAINT "contractor_documents_contractor_id_contractor_profiles_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_profiles" ADD CONSTRAINT "contractor_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_profiles" ADD CONSTRAINT "contractor_profiles_verified_by_id_users_id_fk" FOREIGN KEY ("verified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_members" ADD CONSTRAINT "corporate_members_corporate_id_corporates_id_fk" FOREIGN KEY ("corporate_id") REFERENCES "public"."corporates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_members" ADD CONSTRAINT "corporate_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporates" ADD CONSTRAINT "corporates_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_rider_id_rider_profiles_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."rider_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_seat_claim_id_seat_claims_id_fk" FOREIGN KEY ("seat_claim_id") REFERENCES "public"."seat_claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_retries" ADD CONSTRAINT "refund_retries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_profiles" ADD CONSTRAINT "rider_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_rider_id_rider_profiles_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."rider_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_seat_claim_id_seat_claims_id_fk" FOREIGN KEY ("seat_claim_id") REFERENCES "public"."seat_claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_claims" ADD CONSTRAINT "seat_claims_seat_release_id_seat_releases_id_fk" FOREIGN KEY ("seat_release_id") REFERENCES "public"."seat_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_claims" ADD CONSTRAINT "seat_claims_rider_id_rider_profiles_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."rider_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_claims" ADD CONSTRAINT "seat_claims_corporate_member_id_corporate_members_id_fk" FOREIGN KEY ("corporate_member_id") REFERENCES "public"."corporate_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_claims" ADD CONSTRAINT "seat_claims_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_claims" ADD CONSTRAINT "seat_claims_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_releases" ADD CONSTRAINT "seat_releases_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_releases" ADD CONSTRAINT "seat_releases_rider_id_rider_profiles_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."rider_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_releases" ADD CONSTRAINT "seat_releases_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_impersonated_by_users_id_fk" FOREIGN KEY ("impersonated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shuttle_positions" ADD CONSTRAINT "shuttle_positions_shuttle_id_shuttles_id_fk" FOREIGN KEY ("shuttle_id") REFERENCES "public"."shuttles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shuttles" ADD CONSTRAINT "shuttles_contractor_id_contractor_profiles_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractor_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_rider_id_rider_profiles_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."rider_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_corporate_member_id_corporate_members_id_fk" FOREIGN KEY ("corporate_member_id") REFERENCES "public"."corporate_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telebirr_notify_events" ADD CONSTRAINT "telebirr_notify_events_merch_order_id_payments_reference_fk" FOREIGN KEY ("merch_order_id") REFERENCES "public"."payments"("reference") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tos_acceptances" ADD CONSTRAINT "tos_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_shuttle_id_shuttles_id_fk" FOREIGN KEY ("shuttle_id") REFERENCES "public"."shuttles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_contractor_id_contractor_profiles_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractor_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_actor_id_index" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_type_entity_id_index" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_index" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_index" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "contractor_documents_contractor_id_type_index" ON "contractor_documents" USING btree ("contractor_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "corporate_members_corporate_id_employee_id_index" ON "corporate_members" USING btree ("corporate_id","employee_id");--> statement-breakpoint
CREATE INDEX "corporate_members_corporate_id_index" ON "corporate_members" USING btree ("corporate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_user_id_push_token_index" ON "devices" USING btree ("user_id","push_token");--> statement-breakpoint
CREATE INDEX "faq_articles_category_is_active_sort_order_index" ON "faq_articles" USING btree ("category","is_active","sort_order");--> statement-breakpoint
CREATE INDEX "idempotency_records_expires_at_index" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idempotency_records_user_id_index" ON "idempotency_records" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_id_read_at_index" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "notifications_created_at_index" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "otp_phone_purpose_active_uniq" ON "otp_codes" USING btree ("phone","purpose") WHERE ("otp_codes"."verified" = false and "otp_codes"."expires_at" > now());--> statement-breakpoint
CREATE INDEX "otp_codes_phone_purpose_verified_expires_at_index" ON "otp_codes" USING btree ("phone","purpose","verified","expires_at");--> statement-breakpoint
CREATE INDEX "outbox_events_status_next_attempt_at_index" ON "outbox_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "outbox_events_channel_status_index" ON "outbox_events" USING btree ("channel","status");--> statement-breakpoint
CREATE INDEX "payments_status_created_at_index" ON "payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "payments_rider_id_index" ON "payments" USING btree ("rider_id");--> statement-breakpoint
CREATE INDEX "refund_retries_status_next_attempt_at_index" ON "refund_retries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rides_trip_id_rider_id_index" ON "rides" USING btree ("trip_id","rider_id");--> statement-breakpoint
CREATE INDEX "rides_rider_id_index" ON "rides" USING btree ("rider_id");--> statement-breakpoint
CREATE INDEX "seat_claims_rider_id_index" ON "seat_claims" USING btree ("rider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seat_releases_subscription_id_release_date_window_index" ON "seat_releases" USING btree ("subscription_id","release_date","window");--> statement-breakpoint
CREATE INDEX "seat_releases_status_route_id_index" ON "seat_releases" USING btree ("status","route_id");--> statement-breakpoint
CREATE INDEX "seat_releases_expires_at_index" ON "seat_releases" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_index" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_index" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_expires_at_index" ON "sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "subscriptions_rider_id_status_index" ON "subscriptions" USING btree ("rider_id","status");--> statement-breakpoint
CREATE INDEX "subscriptions_status_end_date_index" ON "subscriptions" USING btree ("status","end_date");--> statement-breakpoint
CREATE INDEX "subscriptions_corporate_member_id_index" ON "subscriptions" USING btree ("corporate_member_id");--> statement-breakpoint
CREATE INDEX "support_tickets_user_id_status_index" ON "support_tickets" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "support_tickets_status_created_at_index" ON "support_tickets" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_id_created_at_index" ON "ticket_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tos_acceptances_user_id_version_index" ON "tos_acceptances" USING btree ("user_id","version");--> statement-breakpoint
CREATE INDEX "trips_route_id_depart_time_index" ON "trips" USING btree ("route_id","depart_time");--> statement-breakpoint
CREATE INDEX "trips_shuttle_id_index" ON "trips" USING btree ("shuttle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trips_shuttle_id_depart_time_window_index" ON "trips" USING btree ("shuttle_id","depart_time","window");--> statement-breakpoint
CREATE INDEX "users_is_active_deleted_at_index" ON "users" USING btree ("is_active","deleted_at");