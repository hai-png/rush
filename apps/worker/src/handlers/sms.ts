import { smsProvider } from '@addis/sms';
import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';

export async function handle(payload: { userId?: string; phone?: string; body: string }) {
  let phone = payload.phone;
  if (!phone && payload.userId) {
    const [u] = await db.select({ phone: schema.users.phone }).from(schema.users).where(eq(schema.users.id, payload.userId));
    phone = u?.phone;
  }
  if (phone) await smsProvider.send(phone, payload.body);
}
