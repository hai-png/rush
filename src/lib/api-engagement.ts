import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { NotFoundError } from '@/lib/errors';
import type { HandlerBody, HandlerBodyParams, HandlerParams, HandlerQuery, HandlerSession, HandlerSessionIp } from '@/lib/handler-types';

export async function GET_notifications(ctx: HandlerQuery) {
  const { session, query } = ctx;
  const { parsePagination, paginatedResponse } = await import('@/lib/pagination');
  const page = parsePagination(query);
  const where: any = { userId: session!.id };
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

export async function POST_mark_read(ctx: HandlerParams) {
  const { session, params } = ctx;
  await db.notification.updateMany({
    where: { id: params.id, userId: session!.id },
    data: { readAt: new Date() },
  });
  return { data: { ok: true } };
}

export async function POST_mark_all_read(ctx: HandlerSession) {
  const { session } = ctx;
  await db.notification.updateMany({
    where: { userId: session!.id, readAt: null },
    data: { readAt: new Date() },
  });
  return { data: { ok: true } };
}

export async function GET_unread_count(ctx: HandlerSession) {
  const { session } = ctx;
  const count = await db.notification.count({ where: { userId: session!.id, readAt: null } });
  return { data: { count } };
}

export async function PATCH_notification(ctx: HandlerBodyParams<{ readAt?: string | null }>) {
  const { session, params, body } = ctx;
  const input = z.object({ readAt: z.union([z.string().datetime(), z.null()]).optional() }).parse(body ?? {});
  const readAt = input.readAt === null ? null : input.readAt ? new Date(input.readAt) : new Date();
  await db.notification.updateMany({
    where: { id: params.id, userId: session!.id },
    data: { readAt },
  });
  return { data: { ok: true } };
}

export async function DELETE_notification(ctx: HandlerParams) {
  const { session, params } = ctx;
  const result = await db.notification.deleteMany({
    where: { id: params.id, userId: session!.id },
  });
  if (result.count === 0) throw new NotFoundError('Notification not found');
  return { status: 204 };
}

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

export async function PATCH_preferences(ctx: HandlerBody<{ emailEnabled?: boolean; smsEnabled?: boolean; pushEnabled?: boolean; quietHoursStart?: string | null; quietHoursEnd?: string | null }>) {
  const { session, body } = ctx;
  const input = PreferencesInput.parse(body);
  const current = await readPrefs(session!.id);
  const merged = { ...current, ...input };
  await db.setting.upsert({
    where: { key: `notif-prefs:${session!.id}` },
    update: { value: JSON.stringify(merged) },
    create: { key: `notif-prefs:${session!.id}`, value: JSON.stringify(merged) },
  });
  return { data: { userId: session!.id, ...merged } };
}

export async function GET_preferences(ctx: HandlerSession) {
  const { session } = ctx;
  const prefs = await readPrefs(session!.id);
  return { data: { userId: session!.id, ...prefs } };
}

const DeviceInput = z.object({
  pushToken: z.string().min(1),
  platform: z.enum(['ios', 'android', 'web']),
  userAgent: z.string().optional(),
});

export async function POST_device(ctx: HandlerBody<{ pushToken: string; platform: 'ios' | 'android' | 'web'; userAgent?: string }>) {
  const { session, body } = ctx;
  const input = DeviceInput.parse(body);
  const existing = await db.device.findUnique({ where: { pushToken: input.pushToken } });
  if (existing) {
    if (existing.userId === session!.id) {
      await db.device.update({ where: { id: existing.id }, data: { platform: input.platform, userAgent: input.userAgent ?? existing.userAgent } });
      return { data: { ok: true, deviceId: existing.id } };
    }
    await db.device.update({ where: { id: existing.id }, data: { userId: session!.id, platform: input.platform, userAgent: input.userAgent ?? null } });
    return { data: { ok: true, deviceId: existing.id } };
  }
  const device = await db.device.create({
    data: {
      userId: session!.id,
      pushToken: input.pushToken,
      platform: input.platform,
      userAgent: input.userAgent ?? null,
    },
  });
  return { data: { ok: true, deviceId: device.id } };
}

export async function DELETE_device(ctx: HandlerBody<{ pushToken: string }>) {
  const { session, body } = ctx;
  const { pushToken } = z.object({ pushToken: z.string() }).parse(body);
  await db.device.deleteMany({ where: { userId: session!.id, pushToken } });
  return { data: { ok: true } };
}

