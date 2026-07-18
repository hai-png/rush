import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';

export async function handle(payload: { userId: string; title: string; body: string; link?: string }) {
  const devices = await db.select().from(schema.devices).where(eq(schema.devices.userId, payload.userId));
  const expoTokens = devices.filter(d => d.platform !== 'web').map(d => d.pushToken);
  if (expoTokens.length) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(expoTokens.map(to => ({ to, title: payload.title, body: payload.body, data: { link: payload.link } }))),
    });
  }
  // web push (VAPID) devices handled similarly via `web-push` library — omitted for brevity
}
