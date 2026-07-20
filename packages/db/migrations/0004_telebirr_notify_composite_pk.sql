-- FOLLOW-UP 2 (PAY-002): Composite PK for telebirrNotifyEvents + state-machine override.
--
-- The original schema had `merchOrderId` as the sole primary key, with the webhook
-- handler doing `INSERT ... ON CONFLICT DO NOTHING RETURNING` and treating
-- `inserted.length === 0` as "already processed". Telebirr can send out-of-order
-- or supplementary notifications for the same order — e.g., a 'failed' on timeout
-- followed by a 'settled' when the payment actually completes. The second
-- notification was silently dropped, leaving the payment in the wrong state.
--
-- This migration:
--   1. Drops the old single-column PK.
--   2. Adds a composite PK on (merch_order_id, out_request_no, received_at) so
--      each distinct Telebirr notification is recorded (outRequestNo is unique
--      per Telebirr notification; received_at disambiguates same-ms duplicates).
--   3. Leaves a non-unique index on merch_order_id for the existing
--      "find latest status for this order" queries.

-- Make out_request_no NOT NULL first (it was nullable; composite PK requires non-null).
UPDATE telebirr_notify_events SET out_request_no = merch_order_id WHERE out_request_no IS NULL;
ALTER TABLE telebirr_notify_events ALTER COLUMN out_request_no SET NOT NULL;

-- Drop the old single-column PK constraint.
ALTER TABLE telebirr_notify_events DROP CONSTRAINT telebirr_notify_events_pkey;

-- Add composite PK.
ALTER TABLE telebirr_notify_events
  ADD CONSTRAINT telebirr_notify_events_pkey
  PRIMARY KEY (merch_order_id, out_request_no, received_at);

-- Index for "find latest notification for this merchOrderId" queries.
CREATE INDEX IF NOT EXISTS telebirr_notify_events_merch_order_id_index
  ON telebirr_notify_events (merch_order_id, received_at DESC);
