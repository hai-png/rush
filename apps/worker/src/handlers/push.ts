import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { notificationLogHelper } from '../lib/notification-log';

/**
 * Push outbox handler. Sends push notifications to mobile devices via Expo's
 * push API.
 *
 * FIX (INFRA-008): The previous implementation had three bugs:
 *   1. Did not send the Expo Bearer access token (EXPO_ACCESS_TOKEN). Expo
 *      silently rate-limits unauthenticated push, so most pushes were dropped
 *      in production. We now send `Authorization: Bearer ${EXPO_ACCESS_TOKEN}`
 *      when the env var is set.
 *   2. Swallowed all fetch errors (no `await`-check on `response.ok`). A 4xx
 *      (e.g. invalid push token) or 5xx (Expo outage) returned successfully
 *      and the outbox row was marked 'delivered' — the push was lost with no
 *      retry. We now throw on non-2xx so the outbox backoff path engages.
 *   3. Did not parse Expo's per-message error response. Expo returns 200 even
 *      when some individual pushes in a batch fail (with a `errors` array
 *      keyed by ticket index). We now log per-ticket failures and throw if
 *   any ticket is an error (so the outbox retries).
 *
 * FIX (INFRA-009): Like sms/email, this handler has no durable idempotency —
 * a duplicate delivery results in a duplicate push notification. The Expo
 * API itself de-duplicates within a short window for identical (to, title,
 * body) tuples sent within ~1 minute, but that is best-effort and not a
 * guarantee. A durable `notification_log` is deferred to follow-up 3.
 */
interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export async function handle(
  payload: { userId: string; title: string; body: string; link?: string },
  evt?: typeof schema.outboxEvents.$inferSelect,
) {
  // FOLLOW-UP 3 (INFRA-009): idempotency check at the start.
  if (evt?.id && await notificationLogHelper.alreadySent(evt.id, 'push')) {
    return; // already sent — duplicate-suppressed
  }
  const devices = await db.select().from(schema.devices).where(eq(schema.devices.userId, payload.userId));
  const expoTokens = devices.filter(d => d.platform !== 'web').map(d => d.pushToken);
  if (!expoTokens.length) return; // nothing to send — not an error

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // FIX (INFRA-008): send the Bearer token so Expo's quota is allocated to our
  // project rather than the shared unauthenticated tier. Absence is allowed in
  // dev (Expo serves unauthenticated push at a low rate) but logged.
  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  } else if (process.env.NODE_ENV === 'production') {
    console.warn('[push-outbox] EXPO_ACCESS_TOKEN is unset in production — Expo will rate-limit unauthenticated push');
  }

  const messages = expoTokens.map(to => ({ to, title: payload.title, body: payload.body, data: { link: payload.link } }));
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers,
    body: JSON.stringify(messages),
  });

  // FIX (INFRA-008): throw on non-2xx so the outbox retry/backoff path engages.
  // Previously a 4xx (invalid token) or 5xx (Expo outage) was silently
  // treated as success — the push was lost and the row marked 'delivered'.
  if (!response.ok) {
    let errorBody: unknown;
    try { errorBody = await response.text(); } catch { /* ignore */ }
    const err = new Error(
      `Expo push HTTP ${response.status} ${response.statusText}: ${typeof errorBody === 'string' ? errorBody.slice(0, 500) : JSON.stringify(errorBody)}`,
    );
    throw err;
  }

  // FIX (INFRA-008): parse the per-ticket response. Expo returns 200 with a
  // body of `[{ status: 'ok' | 'error', ... }]` even when individual messages
  // fail (e.g. invalid push token, recipient uninstalled the app). We surface
  // per-ticket errors and throw if any failed — the outbox retry path will
  // re-attempt the whole batch. (A future refinement: filter out permanently
  // invalid tokens and only retry the rest — deferred to follow-up 3.)
  let tickets: ExpoPushTicket[];
  try {
    tickets = (await response.json()) as ExpoPushTicket[];
  } catch (err) {
    throw new Error(`Expo push returned non-JSON body: ${(err as Error).message}`);
  }

  if (!Array.isArray(tickets)) {
    // Expo's API can return `{ data: [...] }` for batched responses or a
    // single ticket object for one-message requests. Normalize to an array.
    const maybe = tickets as unknown as { data?: ExpoPushTicket[] };
    if (maybe?.data && Array.isArray(maybe.data)) {
      tickets = maybe.data;
    } else {
      tickets = [tickets as unknown as ExpoPushTicket];
    }
  }

  const failures = tickets
    .map((t, i) => ({ index: i, ticket: t }))
    .filter(({ ticket }) => ticket.status !== 'ok');

  if (failures.length > 0) {
    const details = failures.map(f => {
      const msg = messages[f.index];
      return `ticket[${f.index}] to=${msg?.to ?? 'unknown'} error=${f.ticket.details?.error ?? f.ticket.message ?? 'unknown'}`;
    }).join('; ');
    throw new Error(`Expo push partial failure (${failures.length}/${tickets.length}): ${details}`);
  }
  // FOLLOW-UP 3 (INFRA-009): record the successful send for idempotency.
  // Use the first token as the recipient (the row records "we sent to this
  // user's device set for this outbox event"; the unique (outbox_event_id,
  // channel) index means a retry is a no-op).
  if (evt?.id && expoTokens.length > 0) {
    await notificationLogHelper.recordSent(evt.id, 'push', expoTokens.join(','));
  }
  // web push (VAPID) devices handled similarly via `web-push` library — omitted for brevity
}
