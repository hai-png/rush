-- FIX: The composite PK on telebirr_notify_events included received_at, which is set
-- to a fresh timestamp per-insert — replays in different milliseconds would get
-- different PK values and bypass dedup entirely. This drops received_at from the
-- PK, keeping only (merch_order_id, out_request_no), which matches Telebirr's
-- own dedup semantics.
--
-- received_at remains on the row (default now()) for audit, but is no longer
-- part of the uniqueness constraint.

-- Deduplicate: if the same (merch_order_id, out_request_no) exists with
-- different received_at values (from the buggy PK), keep only the earliest row.
DELETE FROM telebirr_notify_events t1
  USING telebirr_notify_events t2
  WHERE t1.ctid < t2.ctid
    AND t1.merch_order_id = t2.merch_order_id
    AND t1.out_request_no = t2.out_request_no;

ALTER TABLE telebirr_notify_events DROP CONSTRAINT telebirr_notify_events_pkey;

ALTER TABLE telebirr_notify_events
  ADD CONSTRAINT telebirr_notify_events_pkey
  PRIMARY KEY (merch_order_id, out_request_no);
