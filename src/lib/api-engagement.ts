import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { z } from 'zod';

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

// ─── Notification preferences ─────────────────────────────────────────────
// Persisted per-user via the Setting model (key: `notif-prefs:<userId>`).
const DEFAULT_PREFS = {
  emailEnabled: true,
  smsEnabled: true,
  pushEnabled: true,
  quietHoursStart: null as string | null,
  quietHoursEnd: null as string | null,
};

const PreferencesInput = z.object({
  emailEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  quietHoursStart: z.string().optional().nullable(),
  quietHoursEnd: z.string().optional().nullable(),
});

async function readPrefs(userId: string): Promise<typeof DEFAULT_PREFS> {
  const row = await db.setting.findUnique({ where: { key: `notif-prefs:${userId}` } });
  if (!row) return { ...DEFAULT_PREFS };
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(row.value) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function PATCH_preferences({ session, body }: any) {
  const input = PreferencesInput.parse(body);
  const current = await readPrefs(session.id);
  const merged = { ...current, ...input };
  await db.setting.upsert({
    where: { key: `notif-prefs:${session.id}` },
    update: { value: JSON.stringify(merged) },
    create: { key: `notif-prefs:${session.id}`, value: JSON.stringify(merged) },
  });
  return { data: { userId: session.id, ...merged } };
}

export async function GET_preferences({ session }: any) {
  const prefs = await readPrefs(session.id);
  return { data: { userId: session.id, ...prefs } };
}

// ─── Device registration (for push notifications) ─────────────────────────
// Persisted per-user via Setting (key: `device:<userId>:<platform>`).
// A real implementation would use a dedicated Device table + a push provider
// (FCM/APNs). This is a working stub that at least survives server restarts,
// unlike the previous in-memory log.
const DeviceInput = z.object({
  pushToken: z.string().min(1),
  platform: z.enum(['ios', 'android', 'web']),
  userAgent: z.string().optional(),
});

export async function POST_device({ session, body }: any) {
  const input = DeviceInput.parse(body);
  const key = `device:${session.id}:${input.platform}`;
  await db.setting.upsert({
    where: { key },
    update: { value: JSON.stringify({ pushToken: input.pushToken, userAgent: input.userAgent, registeredAt: new Date().toISOString() }) },
    create: { key, value: JSON.stringify({ pushToken: input.pushToken, userAgent: input.userAgent, registeredAt: new Date().toISOString() }) },
  });
  logger.info({ userId: session.id, platform: input.platform }, '[device] registered');
  return { status: 201, data: { ok: true } };
}

export async function DELETE_device({ session, body }: any) {
  const { pushToken } = z.object({ pushToken: z.string() }).parse(body);
  // Find the device by token across all platforms for this user.
  const prefix = `device:${session.id}:`;
  const rows = await db.setting.findMany({ where: { key: { startsWith: prefix } } });
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.value);
      if (parsed.pushToken === pushToken) {
        await db.setting.delete({ where: { key: r.key } });
      }
    } catch {}
  }
  return { data: { ok: true } };
}
