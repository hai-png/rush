import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { notificationLogHelper } from '../lib/notification-log';

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

  if (evt?.id && await notificationLogHelper.alreadySent(evt.id, 'push')) {
    return;
  }
  const devices = await db.select().from(schema.devices).where(eq(schema.devices.userId, payload.userId));
  const expoTokens = devices.filter(d => d.platform !== 'web').map(d => d.pushToken);
  if (!expoTokens.length) return;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

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

  if (!response.ok) {
    let errorBody: unknown;
    try { errorBody = await response.text(); } catch {  }
    const err = new Error(
      `Expo push HTTP ${response.status} ${response.statusText}: ${typeof errorBody === 'string' ? errorBody.slice(0, 500) : JSON.stringify(errorBody)}`,
    );
    throw err;
  }

  let tickets: ExpoPushTicket[];
  try {
    tickets = (await response.json()) as ExpoPushTicket[];
  } catch (err) {
    throw new Error(`Expo push returned non-JSON body: ${(err as Error).message}`);
  }

  if (!Array.isArray(tickets)) {

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

  if (evt?.id && expoTokens.length > 0) {
    try { await notificationLogHelper.recordSent(evt.id, 'push', expoTokens.join(',')); }
    catch (err) { console.error('[push-outbox] recordSent failed (duplicate risk):', (err as Error).message); }
  }

}
