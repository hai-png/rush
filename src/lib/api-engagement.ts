import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { NotFoundError } from '@/lib/errors';

export async function GET_notifications({ session, query }: any) {
  const { parsePagination, paginatedResponse } = await import('@/lib/pagination');
  const page = parsePagination(query);
  const where: any = { userId: session.id };
  if (query?.type) where.type = query.type;
  if (query?.unread === 'true') where.readAt = null;
  const [notifs, total] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...page.findManyArgs,
    }),
    db.notification.count({ where }),
  ]);
  return paginatedResponse(notifs, total, page);
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

export async function PATCH_notification({ session, params, body }: any) {
  const input = z.object({ readAt: z.union([z.string().datetime(), z.null()]).optional() }).parse(body ?? {});
  const readAt = input.readAt === null ? null : input.readAt ? new Date(input.readAt) : new Date();
  await db.notification.updateMany({
    where: { id: params.id, userId: session.id },
    data: { readAt },
  });
  return { data: { ok: true } };
}

export async function DELETE_notification({ session, params }: any) {
  const result = await db.notification.deleteMany({
    where: { id: params.id, userId: session.id },
  });
  if (result.count === 0) throw new NotFoundError('Notification not found');
  return { status: 204 };
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
  // CRITICAL FIX (C-11): Push notifications are not implemented. The endpoint
  // previously stored the pushToken in the Setting table but no code ever
  // read it back to dispatch a push — users believed push was enabled but
  // nothing ever arrived. Until a real Device model + FCM/APNs provider is
  // wired up, return 501 so clients know the feature is not available and
  // can surface an appropriate message to the user.
  //
  // To re-enable: implement a Device model in prisma/schema.prisma, wire up
  // an FCM/APNs provider in src/lib/push-providers.ts, and call it from the
  // outbox drainer's push channel (src/lib/scheduler.ts:147-157). Then
  // remove this 501 and restore the original storage logic (using the new
  // Device table, not the Setting table — the Setting-based storage allowed
  // only one token per platform per user, silently overwriting the first
  // device when the app was installed on a second device).
  throw new (await import('@/lib/errors')).NotFoundError(
    'Push notifications are not yet implemented. The mobile app should display "Notifications unavailable" and hide the push toggle.'
  );
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
