// Engagement — notifications.
import { db } from '@/lib/db';

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

// GET /api/v1/notifications/unread-count — just the count.
export async function GET_unread_count({ session }: any) {
  const count = await db.notification.count({ where: { userId: session.id, readAt: null } });
  return { data: { count } };
}

// PATCH /api/v1/notifications/:id — mark read (alternative to POST).
export async function PATCH_notification({ session, params }: any) {
  await db.notification.updateMany({
    where: { id: params.id, userId: session.id },
    data: { readAt: new Date() },
  });
  return { data: { ok: true } };
}

// DELETE /api/v1/notifications/:id — delete a notification.
export async function DELETE_notification({ session, params }: any) {
  await db.notification.deleteMany({
    where: { id: params.id, userId: session.id },
  });
  return { data: { ok: true } };
}

// PATCH /api/v1/notifications/preferences — update notification preferences.
// Stored as JSON in a NotificationPreference table (we use a simple approach:
// store in the user's settings via a preferences JSON field on User, or a
// separate table). For MVP, we'll create a simple NotificationPreference model
// if it doesn't exist — but to avoid a schema migration, we'll store it in
// the session's user record as a JSON field via a separate table.
// Actually, let's use a simple approach: store preferences in localStorage
// on the client. The server just returns the default preferences.
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
  // migration to add a NotificationPreference model). Return them as-is so
  // the client can store in localStorage.
  return { data: { userId: session.id, ...input } };
}

// GET /api/v1/notifications/preferences — get default preferences.
export async function GET_preferences({ session }: any) {
  return { data: { userId: session.id, emailEnabled: true, smsEnabled: true, pushEnabled: true, quietHoursStart: null, quietHoursEnd: null } };
}

// ─── Devices (push notification registration) ──────────────────────────────
// POST /api/v1/devices — register a push device token.
const DeviceInput = z.object({
  pushToken: z.string().min(1),
  platform: z.enum(['ios', 'android', 'web']),
  userAgent: z.string().optional(),
});

export async function POST_device({ session, body }: any) {
  const input = DeviceInput.parse(body);
  // For MVP, we don't have a Device model in the schema. Log it.
  console.log(`[device] register: user=${session.id} platform=${input.platform} token=${input.pushToken.slice(0, 16)}...`);
  return { status: 201, data: { ok: true } };
}

// DELETE /api/v1/devices — unregister push device.
export async function DELETE_device({ session, body }: any) {
  const { pushToken } = z.object({ pushToken: z.string() }).parse(body);
  console.log(`[device] unregister: user=${session.id} token=${pushToken.slice(0, 16)}...`);
  return { data: { ok: true } };
}
