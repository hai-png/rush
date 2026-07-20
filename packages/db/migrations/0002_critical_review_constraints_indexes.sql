-- CRITICAL REVIEW (DB-001/002/004/009/010/011, SEC-003, INFRA-007):
--
-- Re-installs the append-only trigger function (idempotent), adds 9 CHECK
-- constraints and 12 indexes declared in schema.ts but missing from
-- migration 0000, plus 4 additional indexes required by hot paths.

-- 1. Audit append-only trigger with retention-purge escape hatch
-- (Re-declared here in case 0001 was missed — idempotent.)
CREATE OR REPLACE FUNCTION block_audit_mutation() RETURNS trigger AS $$
DECLARE
    purge_flag text;
BEGIN
    purge_flag := current_setting('app.audit_retention_purge', true);
    IF TG_OP = 'DELETE' AND purge_flag = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'audit_logs is append-only — % not allowed (purge_flag=%)', TG_OP, purge_flag;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION block_audit_mutation();
DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs;
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION block_audit_mutation();

-- 2. Missing CHECK constraints
ALTER TABLE shuttles ADD CONSTRAINT IF NOT EXISTS capacity_positive CHECK (capacity > 0 AND capacity <= 100);
ALTER TABLE shuttles ADD CONSTRAINT IF NOT EXISTS year_valid CHECK (year BETWEEN 1990 AND EXTRACT(YEAR FROM now()) + 1);
ALTER TABLE subscription_plans ADD CONSTRAINT IF NOT EXISTS rides_included_valid CHECK (rides_included = -1 OR rides_included > 0);
ALTER TABLE subscription_plans ADD CONSTRAINT IF NOT EXISTS duration_days_positive CHECK (duration_days > 0);
ALTER TABLE subscription_plans ADD CONSTRAINT IF NOT EXISTS price_etb_nonneg CHECK (price_etb >= 0);
ALTER TABLE subscriptions ADD CONSTRAINT IF NOT EXISTS sub_end_after_start CHECK (end_date > start_date);
ALTER TABLE subscriptions ADD CONSTRAINT IF NOT EXISTS sub_rides_used_nonneg CHECK (rides_used >= 0);
ALTER TABLE payments ADD CONSTRAINT IF NOT EXISTS amount_nonneg CHECK (amount >= 0);
ALTER TABLE payments ADD CONSTRAINT IF NOT EXISTS refund_amount_nonneg CHECK (refund_amount >= 0);

-- DB-013: routes / shuttle_positions sanity checks
ALTER TABLE routes ADD CONSTRAINT IF NOT EXISTS distance_km_positive CHECK (distance_km > 0);
ALTER TABLE routes ADD CONSTRAINT IF NOT EXISTS duration_min_positive CHECK (duration_min > 0);
ALTER TABLE routes ADD CONSTRAINT IF NOT EXISTS fare_nonneg CHECK (fare >= 0);
ALTER TABLE shuttle_positions ADD CONSTRAINT IF NOT EXISTS lat_range CHECK (lat BETWEEN -90 AND 90);
ALTER TABLE shuttle_positions ADD CONSTRAINT IF NOT EXISTS lng_range CHECK (lng BETWEEN -180 AND 180);

-- 3. Missing indexes declared in schema.ts
CREATE INDEX IF NOT EXISTS corporate_members_user_id_index ON corporate_members (user_id);
CREATE INDEX IF NOT EXISTS payments_subscription_id_index ON payments (subscription_id);
CREATE INDEX IF NOT EXISTS payments_seat_claim_id_index ON payments (seat_claim_id);
CREATE INDEX IF NOT EXISTS seat_claims_payment_id_index ON seat_claims (payment_id);
CREATE INDEX IF NOT EXISTS rides_subscription_id_index ON rides (subscription_id);
CREATE INDEX IF NOT EXISTS rides_seat_claim_id_index ON rides (seat_claim_id);
CREATE INDEX IF NOT EXISTS support_tickets_subscription_id_index ON support_tickets (subscription_id);
CREATE INDEX IF NOT EXISTS support_tickets_payment_id_index ON support_tickets (payment_id);

-- 4. Additional indexes NOT in schema.ts (DB-004/009/010/011)
CREATE INDEX IF NOT EXISTS refund_retries_payment_id_index ON refund_retries (payment_id);
CREATE INDEX IF NOT EXISTS corporate_members_last_reset_at_index ON corporate_members (last_reset_at);
CREATE INDEX IF NOT EXISTS outbox_events_payload_gin ON outbox_events USING gin (payload jsonb_path_ops);
CREATE UNIQUE INDEX IF NOT EXISTS contractor_documents_contractor_checksum_uniq ON contractor_documents (contractor_id, checksum_sha256);

-- 5. updated_at auto-update trigger (DB-008)
CREATE OR REPLACE FUNCTION bump_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    t text;
BEGIN
    FOR t IN
        SELECT table_name FROM information_schema.columns
        WHERE column_name = 'updated_at'
          AND table_schema = 'public'
          AND table_name NOT IN ('audit_logs')
        GROUP BY table_name
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I;', t || '_bump_updated_at', t);
        EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION bump_updated_at();', t || '_bump_updated_at', t);
    END LOOP;
END;
$$;
