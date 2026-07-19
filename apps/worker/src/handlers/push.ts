import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';

/**
 * Push notification handler. Sends to Expo push tokens (iOS + Android).
 *
 * Web push (VAPID) is not yet implemented — the previous code had a comment
 * saying "omitted for brevity" which would silently drop all web push events.
 * We now explicitly throw for web-platform devices so the outbox retry/backoff
 * engages and the event isn't silently lost.
 */
export async function handle(payload: { userId: string; title: string; body: string; link?: string }) {
  const devices = await db.select().from(schema.devices).where(eq(schema.devices.userId, payload.userId));
  const expoTokens = devices.filter(d => d.platform !== 'web').map(d => d.pushToken);
  const webTokens = devices.filter(d => d.platform === 'web');

  if (expoTokens.length) {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(expoTokens.map(to => ({
        to, title: payload.title, body: payload.body, data: { link: payload.link },
      }))),
    });
    if (!res.ok) {
      throw new Error(`Expo push API returned ${res.status}: ${await res.text()}`);
    }
  }

  if (webTokens.length) {
    // Web push (VAPID) is not yet wired — throw so the outbox retries. When the
    // `web-push` library is added, this branch should send VAPID-encrypted pushes
    // to each web token.
    throw new Error(`Web push not implemented — ${webTokens.length} device(s) cannot be notified`);
  }
}
