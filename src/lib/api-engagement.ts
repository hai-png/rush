import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export async function GET_notifications({ session }: any) {
  const notifs = await db.notification.findMany({
    where: { userId: session.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return { data: notifs };
}

export async function POST_mark_read({ session, params }: any) {
  await db.notification.updateMany({
    where: { id: params.id, userId: session.id },
    data: { readAt: new Date() },
  });
  return { data: { ok: true } };
}

export async function POST_mark_all_read({ session }: any) {
  await db.notification.updateMany({
    where: { userId: session.id, readAt: null },
    data: { readAt: new Date() },
  });
  return { data: { ok: true } };
}

export async function GET_unread_count({ session }: any) {
  const count = await db.notification.count({ where: { userId: session.id, readAt: null } });
  return { data: { count } };
}

export async function PATCH_notification({ session, params }: any) {
  await db.notification.updateMany({
    where: { id: params.id, userId: session.id },
    data: { readAt: new Date() },
  });
  return { data: { ok: true } };
}

export async function DELETE_notification({ session, params }: any) {
  await db.notification.deleteMany({
    where: { id: params.id, userId: session.id },
  });
  return { data: { ok: true } };
}

import { z } from 'zod';

const PreferencesInput = z.object({
  emailEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  quietHoursStart: z.string().optional(),
  quietHoursEnd: z.string().optional(),
});

export async function PATCH_preferences({ session, body }: any) {
  const input = PreferencesInput.parse(body);
  // For MVP, we don't persist preferences server-side (would need a schema
  return { data: { userId: session.id, ...input } };
}

export async function GET_preferences({ session }: any) {
  return { data: { userId: session.id, emailEnabled: true, smsEnabled: true, pushEnabled: true, quietHoursStart: null, quietHoursEnd: null } };
}

const DeviceInput = z.object({
  pushToken: z.string().min(1),
  platform: z.enum(['ios', 'android', 'web']),
  userAgent: z.string().optional(),
});

export async function POST_device({ session, body }: any) {
  const input = DeviceInput.parse(body);
  // For MVP, we don't have a Device model in the schema. Log it.
  logger.info({ userId: session.id, platform: input.platform }, '[device] register');
  return { status: 201, data: { ok: true } };
}

export async function DELETE_device({ session, body }: any) {
  const { pushToken } = z.object({ pushToken: z.string() }).parse(body);
  logger.info({ userId: session.id }, '[device] unregister');
  return { data: { ok: true } };
}
