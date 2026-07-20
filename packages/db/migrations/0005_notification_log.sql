-- FOLLOW-UP 3 (INFRA-009): Durable notification_log table for SMS/email/push idempotency.
--
-- The worker's SMS/email/push handlers retry on failure (via the outbox) but
-- had no idempotency: an outbox retry after a partial failure re-sent the
-- message. This table records every successfully-sent message, keyed by the
-- outbox event id + channel, so handlers can skip re-sends.
--
-- Retention: 90 days (matches the outbox retention). Old rows are pruned by
-- the cleanup-old-outbox-events cron (extended in this migration to also
-- prune notification_log).

CREATE TABLE IF NOT EXISTS notification_log (
  id text PRIMARY KEY,
  outbox_event_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms', 'email', 'push')),
  -- The provider's message id (e.g. Africa's Talking message_id, Expo ticket,
  -- SMTP Message-Id). Used for delivery-receipt correlation.
  provider_message_id text,
  -- The recipient (phone for SMS, email for email, Expo token for push).
  -- Stored for forensic lookup ("did we send to this number in the last 90d?").
  recipient text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  -- Unique on (outbox_event_id, channel) so the same outbox event can't
  -- produce two log rows for the same channel — the handler's idempotency check.
  CONSTRAINT notification_log_outbox_channel_uniq UNIQUE (outbox_event_id, channel)
);

CREATE INDEX IF NOT EXISTS notification_log_recipient_sent_at_index
  ON notification_log (recipient, sent_at DESC);
CREATE INDEX IF NOT EXISTS notification_log_sent_at_index
  ON notification_log (sent_at);
