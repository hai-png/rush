-- Addis Ride initial schema migration.
-- Generated from packages/db/src/schema.ts. All enums, tables, indexes, and
-- check constraints are declared here so a fresh `bun run db:migrate` produces
-- a database that exactly matches the Drizzle schema.

-- ---------- enums ----------
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('rider', 'contractor', 'corporate_admin', 'platform_admin');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE verification_status AS ENUM ('unverified', 'pending', 'verified', 'rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM ('pending_payment', 'active', 'expired', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded', 'partially_refunded');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('telebirr', 'cbe');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE refund_status AS ENUM ('pending', 'succeeded', 'failed', 'permanent_failure');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE trip_status AS ENUM ('scheduled', 'in_transit', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE ride_status AS ENUM ('booked', 'boarded', 'completed', 'no_show', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE seat_release_status AS ENUM ('open', 'claimed', 'expired', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE seat_claim_status AS ENUM ('confirmed', 'used', 'no_show', 'refunded');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE seat_window AS ENUM ('morning', 'evening');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM ('open', 'in_progress', 'resolved', 'closed');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE ticket_priority AS ENUM ('low', 'normal', 'high', 'urgent');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE ticket_category AS ENUM ('general', 'billing', 'route', 'shuttle', 'account', 'corporate', 'other');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE faq_category AS ENUM ('billing', 'routes', 'shuttle', 'account', 'corporate', 'general');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    'payment_received', 'payment_failed', 'refund_completed', 'refund_failed',
    'seat_claimed', 'seat_released', 'seat_release_expired',
    'subscription_expiring', 'subscription_expired', 'subscription_cancelled',
    'trip_departing', 'document_verified', 'document_rejected',
    'support_reply', 'support_resolved',
    'corporate_member_added', 'corporate_member_removed', 'corporate_reset', 'general'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE otp_purpose AS ENUM ('signup_verification', 'password_reset', 'phone_change');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE vehicle_type AS ENUM ('coaster', 'minibus', 'van', 'sedan');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE outbox_channel AS ENUM ('notification', 'sms', 'push', 'email', 'refund', 'audit', 'webhook');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------- tables ----------
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  phone text NOT NULL UNIQUE,
  email text,
  password_hash text NOT NULL,
  name text NOT NULL,
  role user_role NOT NULL DEFAULT 'rider',
  phone_verified boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  token_version integer NOT NULL DEFAULT 0,
  two_factor_secret text,
  two_factor_enabled boolean NOT NULL DEFAULT false,
  tos_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_is_active_deleted_at_idx ON users (is_active, deleted_at);

CREATE TABLE IF NOT EXISTS rider_profiles (
  id text PRIMARY KEY,
  user_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  home_area text NOT NULL,
  work_area text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contractor_profiles (
  id text PRIMARY KEY,
  user_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  license_number text NOT NULL UNIQUE,
  experience_years integer NOT NULL DEFAULT 0,
  rating real NOT NULL DEFAULT 5.0,
  verification_status verification_status NOT NULL DEFAULT 'unverified',
  verification_reason text,
  verified_by_id text REFERENCES users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contractor_documents (
  id text PRIMARY KEY,
  contractor_id text NOT NULL REFERENCES contractor_profiles(id) ON DELETE CASCADE,
  type text NOT NULL,
  original_filename text NOT NULL,
  storage_key text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  checksum_sha256 text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contractor_documents_contractor_id_type_idx ON contractor_documents (contractor_id, type);

CREATE TABLE IF NOT EXISTS corporates (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  contact_email text NOT NULL,
  contact_phone text NOT NULL,
  subsidy_percent integer NOT NULL DEFAULT 50,
  monthly_seat_allowance integer NOT NULL DEFAULT 20,
  admin_user_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subsidy_range CHECK (subsidy_percent BETWEEN 0 AND 100)
);

CREATE TABLE IF NOT EXISTS corporate_members (
  id text PRIMARY KEY,
  corporate_id text NOT NULL REFERENCES corporates(id) ON DELETE CASCADE,
  user_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  employee_id text NOT NULL,
  approval_status text NOT NULL DEFAULT 'pending',
  rides_used_this_month integer NOT NULL DEFAULT 0,
  last_reset_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS corporate_members_corporate_id_employee_id_idx ON corporate_members (corporate_id, employee_id);
CREATE INDEX IF NOT EXISTS corporate_members_corporate_id_idx ON corporate_members (corporate_id);

CREATE TABLE IF NOT EXISTS routes (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  origin text NOT NULL,
  destination text NOT NULL,
  stops jsonb NOT NULL DEFAULT '[]',
  polyline jsonb NOT NULL DEFAULT '[]',
  origin_lat_lng jsonb NOT NULL,
  dest_lat_lng jsonb NOT NULL,
  distance_km real NOT NULL,
  duration_min integer NOT NULL,
  morning_window jsonb NOT NULL,
  evening_window jsonb NOT NULL,
  fare decimal(12, 2) NOT NULL,
  needs_shuttle boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shuttles (
  id text PRIMARY KEY,
  plate_number text NOT NULL UNIQUE,
  model text NOT NULL,
  year integer NOT NULL,
  vehicle_type vehicle_type NOT NULL,
  capacity integer NOT NULL DEFAULT 14,
  contractor_id text REFERENCES contractor_profiles(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  duration_days integer NOT NULL,
  rides_included integer NOT NULL,
  price_etb decimal(12, 2) NOT NULL,
  description text NOT NULL,
  is_popular boolean NOT NULL DEFAULT false,
  is_trial boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id text PRIMARY KEY,
  rider_id text NOT NULL REFERENCES rider_profiles(id) ON DELETE RESTRICT,
  plan_id text NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  route_id text REFERENCES routes(id) ON DELETE SET NULL,
  corporate_member_id text REFERENCES corporate_members(id) ON DELETE SET NULL,
  status subscription_status NOT NULL DEFAULT 'pending_payment',
  rides_used integer NOT NULL DEFAULT 0,
  morning_slot text,
  evening_slot text,
  start_date timestamptz NOT NULL DEFAULT now(),
  end_date timestamptz NOT NULL,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_rider_id_status_idx ON subscriptions (rider_id, status);
CREATE INDEX IF NOT EXISTS subscriptions_status_end_date_idx ON subscriptions (status, end_date);
CREATE INDEX IF NOT EXISTS subscriptions_corporate_member_id_idx ON subscriptions (corporate_member_id);

CREATE TABLE IF NOT EXISTS trips (
  id text PRIMARY KEY,
  shuttle_id text NOT NULL REFERENCES shuttles(id) ON DELETE RESTRICT,
  contractor_id text REFERENCES contractor_profiles(id) ON DELETE SET NULL,
  route_id text NOT NULL REFERENCES routes(id) ON DELETE RESTRICT,
  window seat_window NOT NULL,
  depart_time timestamptz NOT NULL,
  arrive_time timestamptz,
  status trip_status NOT NULL DEFAULT 'scheduled',
  seats_booked integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trips_route_id_depart_time_idx ON trips (route_id, depart_time);
CREATE INDEX IF NOT EXISTS trips_shuttle_id_idx ON trips (shuttle_id);

CREATE TABLE IF NOT EXISTS seat_releases (
  id text PRIMARY KEY,
  subscription_id text NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  rider_id text NOT NULL REFERENCES rider_profiles(id) ON DELETE RESTRICT,
  route_id text NOT NULL REFERENCES routes(id) ON DELETE RESTRICT,
  window seat_window NOT NULL,
  release_date date NOT NULL,
  refund_amount decimal(12, 2) NOT NULL,
  status seat_release_status NOT NULL DEFAULT 'open',
  expires_at timestamptz NOT NULL,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS seat_releases_subscription_id_release_date_window_idx ON seat_releases (subscription_id, release_date, window);
CREATE INDEX IF NOT EXISTS seat_releases_status_route_id_idx ON seat_releases (status, route_id);
CREATE INDEX IF NOT EXISTS seat_releases_expires_at_idx ON seat_releases (expires_at);

CREATE TABLE IF NOT EXISTS seat_claims (
  id text PRIMARY KEY,
  seat_release_id text NOT NULL UNIQUE REFERENCES seat_releases(id) ON DELETE CASCADE,
  rider_id text NOT NULL REFERENCES rider_profiles(id) ON DELETE RESTRICT,
  corporate_member_id text REFERENCES corporate_members(id) ON DELETE SET NULL,
  route_id text NOT NULL REFERENCES routes(id) ON DELETE RESTRICT,
  window seat_window NOT NULL,
  claim_date timestamptz NOT NULL DEFAULT now(),
  payment_id text REFERENCES payments(id) ON DELETE SET NULL,
  status seat_claim_status NOT NULL DEFAULT 'confirmed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seat_claims_rider_id_idx ON seat_claims (rider_id);

-- payments is referenced by seat_claims above via a forward reference; declare its indexes now.
CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY,
  rider_id text NOT NULL REFERENCES rider_profiles(id) ON DELETE RESTRICT,
  subscription_id text REFERENCES subscriptions(id) ON DELETE SET NULL,
  seat_claim_id text REFERENCES seat_claims(id) ON DELETE SET NULL,
  amount decimal(12, 2) NOT NULL,
  method payment_method NOT NULL,
  reference text NOT NULL UNIQUE,
  prepay_id text,
  status payment_status NOT NULL DEFAULT 'pending',
  refund_amount decimal(12, 2),
  refunded_at timestamptz,
  retention_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_status_created_at_idx ON payments (status, created_at);
CREATE INDEX IF NOT EXISTS payments_rider_id_idx ON payments (rider_id);

CREATE TABLE IF NOT EXISTS rides (
  id text PRIMARY KEY,
  rider_id text NOT NULL REFERENCES rider_profiles(id) ON DELETE RESTRICT,
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE RESTRICT,
  subscription_id text REFERENCES subscriptions(id) ON DELETE SET NULL,
  seat_claim_id text REFERENCES seat_claims(id) ON DELETE SET NULL,
  status ride_status NOT NULL DEFAULT 'booked',
  pickup_stop text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rides_trip_id_rider_id_idx ON rides (trip_id, rider_id);
CREATE INDEX IF NOT EXISTS rides_rider_id_idx ON rides (rider_id);

CREATE TABLE IF NOT EXISTS refund_retries (
  id text PRIMARY KEY,
  payment_id text NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  merch_order_id text NOT NULL,
  refund_request_no text NOT NULL UNIQUE,
  amount decimal(12, 2) NOT NULL,
  reason text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  status refund_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refund_retries_status_next_attempt_at_idx ON refund_retries (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS support_tickets (
  id text PRIMARY KEY,
  subject text NOT NULL,
  body text NOT NULL,
  status ticket_status NOT NULL DEFAULT 'open',
  priority ticket_priority NOT NULL DEFAULT 'normal',
  category ticket_category NOT NULL DEFAULT 'general',
  user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  subscription_id text REFERENCES subscriptions(id) ON DELETE SET NULL,
  payment_id text REFERENCES payments(id) ON DELETE SET NULL,
  assigned_to_id text REFERENCES users(id) ON DELETE SET NULL,
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_tickets_user_id_status_idx ON support_tickets (user_id, status);
CREATE INDEX IF NOT EXISTS support_tickets_status_created_at_idx ON support_tickets (status, created_at);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id text PRIMARY KEY,
  ticket_id text NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body text NOT NULL,
  is_staff boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_messages_ticket_id_created_at_idx ON ticket_messages (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_id_read_at_idx ON notifications (user_id, read_at);
CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON notifications (created_at);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id text PRIMARY KEY,
  user_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  prefs jsonb NOT NULL DEFAULT '{}',
  quiet_hours_start text,
  quiet_hours_end text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  push_token text NOT NULL,
  platform text NOT NULL,
  user_agent text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS devices_user_id_push_token_idx ON devices (user_id, push_token);

CREATE TABLE IF NOT EXISTS outbox_events (
  id text PRIMARY KEY,
  channel outbox_channel NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_events_status_next_attempt_at_idx ON outbox_events (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS outbox_events_channel_status_idx ON outbox_events (channel, status);

CREATE TABLE IF NOT EXISTS idempotency_records (
  key text PRIMARY KEY,
  user_id text,
  method text NOT NULL,
  path text NOT NULL,
  request_body_hash text NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY,
  actor_id text REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  before jsonb,
  after jsonb,
  ip_address text,
  user_agent text,
  prev_hash text,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_actor_id_idx ON audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS audit_logs_entity_type_entity_id_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (action);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at);

CREATE TABLE IF NOT EXISTS otp_codes (
  id text PRIMARY KEY,
  phone text NOT NULL,
  purpose otp_purpose NOT NULL,
  code_hash text NOT NULL,
  user_id text REFERENCES users(id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_codes_phone_purpose_verified_expires_at_idx ON otp_codes (phone, purpose, verified, expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tos_acceptances (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version text NOT NULL,
  ip_address text,
  user_agent text,
  accepted_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tos_acceptances_user_id_version_idx ON tos_acceptances (user_id, version);

CREATE TABLE IF NOT EXISTS faq_articles (
  id text PRIMARY KEY,
  category faq_category NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  question_am text,
  answer_am text,
  sort_order integer NOT NULL DEFAULT 0,
  helpful_yes integer NOT NULL DEFAULT 0,
  helpful_no integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS faq_articles_category_is_active_sort_order_idx ON faq_articles (category, is_active, sort_order);

CREATE TABLE IF NOT EXISTS shuttle_positions (
  shuttle_id text PRIMARY KEY REFERENCES shuttles(id) ON DELETE CASCADE,
  lat real NOT NULL,
  lng real NOT NULL,
  heading real,
  speed real,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telebirr_notify_events (
  merch_order_id text PRIMARY KEY,
  trade_status text NOT NULL,
  out_request_no text,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jti text NOT NULL UNIQUE,
  user_agent text,
  ip_address text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- updated_at triggers ----------
-- Auto-maintain updated_at on every table that has one. Without these the column
-- is only set on INSERT (via the DEFAULT now()), never on UPDATE — so the
-- dashboard's "recently updated" queries would silently break.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'users', 'rider_profiles', 'contractor_profiles', 'corporates', 'corporate_members',
    'routes', 'shuttles', 'subscription_plans', 'subscriptions', 'trips', 'seat_releases',
    'payments', 'seat_claims', 'rides', 'refund_retries', 'support_tickets',
    'notification_preferences', 'outbox_events', 'faq_articles'
  ]) LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at_trigger ON %I; CREATE TRIGGER set_updated_at_trigger BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
      t, t
    );
  END LOOP;
END $$;
