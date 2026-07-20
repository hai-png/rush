-- CRITICAL REVIEW ROUND 2 — DB fixes (DB-001, DB-002, DB-005, DB-006, DB-007).
--
-- This migration addresses findings from the second-round critical review:
--   * DB-001: 0006's telebirr_notify_events dedup used ctid comparison which
--     is non-deterministic — may keep the wrong (failed) row when the second
--     notification was Success. Re-dedup deterministically by received_at
--     DESC + trade_status priority (Success > Fail > anything else). This
--     is a no-op if 0006 already ran cleanly; it cleans up any bad state.
--   * DB-002: add a trigger preventing hard-DELETE on users with dependent
--     rows. Soft-delete + anonymize is the policy; hard-delete is a bug.
--   * DB-005: prevent trial plans from having rides_included = -1 (unlimited
--     trials) via a CHECK constraint.
--   * DB-006: add a trigger enforcing trips.seats_booked <= shuttles.capacity
--     (defense in depth — the app uses CAS, but a direct SQL UPDATE should
--     also be blocked).
--   * DB-007: drop the unused password_reset_tokens table. Password reset
--     uses otp_codes with purpose='password_reset'; the password_reset_tokens
--     table is dead schema.

-- ============================================================================
-- DB-001: deterministic re-dedup of telebirr_notify_events
-- ============================================================================
-- Only run if there are still duplicate rows (0006 may have left some if the
-- ctid-based dedup kept the wrong row). Use a window function to keep the
-- row with the latest received_at, breaking ties by trade_status priority.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (
      SELECT merch_order_id, out_request_no, count(*) AS n
      FROM telebirr_notify_events
      GROUP BY merch_order_id, out_request_no
      HAVING count(*) > 1
    ) s
  ) THEN
    DELETE FROM telebirr_notify_events
    WHERE (merch_order_id, out_request_no, received_at) IN (
      SELECT merch_order_id, out_request_no, received_at
      FROM (
        SELECT
          merch_order_id,
          out_request_no,
          received_at,
          ROW_NUMBER() OVER (
            PARTITION BY merch_order_id, out_request_no
            ORDER BY
              received_at DESC,
              CASE trade_status
                WHEN 'Success' THEN 1
                WHEN 'Fail' THEN 2
                ELSE 3
              END
          ) AS rn
        FROM telebirr_notify_events
      ) t
      WHERE t.rn > 1
    );
  END IF;
END $$;

-- ============================================================================
-- DB-002: prevent hard-DELETE on users with dependent rows
-- ============================================================================
-- The policy is soft-delete (set deleted_at, is_active=false) + anonymize
-- after 30 days. Hard DELETE fails with FK violations on payments, rides,
-- subscriptions, etc. — surfacing as 500 errors with no useful message.
-- This trigger raises a clear exception explaining the policy.

CREATE OR REPLACE FUNCTION prevent_user_hard_delete() RETURNS trigger AS $$
DECLARE
  blocker text;
BEGIN
  -- Check each dependent table; raise on the first one that has rows.
  IF EXISTS (SELECT 1 FROM subscriptions WHERE rider_id = OLD.id) THEN
    blocker := 'subscriptions';
  ELSIF EXISTS (SELECT 1 FROM payments WHERE rider_id = OLD.id) THEN
    blocker := 'payments';
  ELSIF EXISTS (SELECT 1 FROM seat_releases WHERE rider_id = OLD.id) THEN
    blocker := 'seat_releases';
  ELSIF EXISTS (SELECT 1 FROM seat_claims WHERE rider_id = OLD.id) THEN
    blocker := 'seat_claims';
  ELSIF EXISTS (SELECT 1 FROM rides WHERE rider_id = OLD.id) THEN
    blocker := 'rides';
  ELSIF EXISTS (SELECT 1 FROM contractor_profiles WHERE user_id = OLD.id) THEN
    blocker := 'contractor_profiles';
  ELSIF EXISTS (SELECT 1 FROM corporates WHERE admin_user_id = OLD.id) THEN
    blocker := 'corporates (admin)';
  ELSIF EXISTS (SELECT 1 FROM corporate_members WHERE user_id = OLD.id AND deleted_at IS NULL) THEN
    blocker := 'corporate_members';
  ELSIF EXISTS (SELECT 1 FROM support_tickets WHERE user_id = OLD.id) THEN
    blocker := 'support_tickets';
  END IF;

  IF blocker IS NOT NULL THEN
    RAISE EXCEPTION 'Hard DELETE on users is blocked — user % has dependent rows in %. Use soft-delete (set deleted_at, is_active=false) and let retention-cleanup anonymize after 30 days.',
      OLD.id, blocker;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_prevent_hard_delete ON users;
CREATE TRIGGER users_prevent_hard_delete BEFORE DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION prevent_user_hard_delete();

-- ============================================================================
-- DB-005: prevent unlimited trial plans
-- ============================================================================
-- A trial plan with rides_included = -1 (unlimited) would let a user ride
-- unlimited for the trial duration (e.g. 14 days). The hasUsedTrial check
-- prevents re-use, but a misconfigured trial plan is still a money leak.
ALTER TABLE subscription_plans DROP CONSTRAINT IF EXISTS no_unlimited_trial;
ALTER TABLE subscription_plans ADD CONSTRAINT no_unlimited_trial
  CHECK (NOT (is_trial = true AND rides_included = -1));

-- ============================================================================
-- DB-006: enforce trips.seats_booked <= shuttles.capacity via trigger
-- ============================================================================
-- The app uses a CAS UPDATE (WHERE seats_booked < capacity) to atomically
-- increment seats_booked, which is correct. But the DB has no constraint
-- enforcing seats_booked <= capacity — a direct SQL UPDATE (e.g. a migration
-- bug, a manual fix, a future code path) could overbook. This trigger is
-- defense in depth.

CREATE OR REPLACE FUNCTION check_trips_seats_booked() RETURNS trigger AS $$
DECLARE
  shuttle_capacity integer;
BEGIN
  SELECT capacity INTO shuttle_capacity FROM shuttles WHERE id = NEW.shuttle_id;
  IF shuttle_capacity IS NULL THEN
    RAISE EXCEPTION 'Shuttle % not found for trip %', NEW.shuttle_id, NEW.id;
  END IF;
  IF NEW.seats_booked > shuttle_capacity THEN
    RAISE EXCEPTION 'Trip % would overbook shuttle %: seats_booked=% exceeds capacity=%',
      NEW.id, NEW.shuttle_id, NEW.seats_booked, shuttle_capacity;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trips_seats_booked_check ON trips;
CREATE TRIGGER trips_seats_booked_check
  BEFORE INSERT OR UPDATE OF seats_booked ON trips
  FOR EACH ROW EXECUTE FUNCTION check_trips_seats_booked();

-- ============================================================================
-- DB-007: drop the unused password_reset_tokens table
-- ============================================================================
-- The password-reset flow uses otp_codes with purpose='password_reset'.
-- password_reset_tokens is dead schema — no code writes to it. The
-- retention-cleanup cron deletes from it (always 0 rows). Drop it.
DROP TABLE IF EXISTS password_reset_tokens CASCADE;
