import { eq, and, isNull, lt, sql } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import type { NotificationType } from '@addis/shared';
import type { NotificationEnvelope, ChannelKey } from './types';
import { CRITICAL_TYPES } from './types';
import { renderTemplate } from './templates';

const DEFAULT_PREFS: Record<ChannelKey, boolean> = { inApp: true, push: true, sms: false, email: false };

function isQuietHours(start?: string | null, end?: string | null): boolean {
  if (!start || !end) return false;
  const now = new Date().toTimeString().slice(0, 5);
  return start < end ? (now >= start && now < end) : (now >= start || now < end); // handles overnight window
}

export const engagementService = {
  async getPreferences(userId: string) {
    const [row] = await db.select().from(schema.notificationPreferences).where(eq(schema.notificationPreferences.userId, userId));
    return row ?? { userId, prefs: {}, quietHoursStart: null, quietHoursEnd: null };
  },
  async updatePreferences(userId: string, input: { prefs?: Record<string, Partial<Record<ChannelKey, boolean>>>; quietHoursStart?: string; quietHoursEnd?: string }) {
    const [row] = await db.insert(schema.notificationPreferences).values({ userId, ...input } as any)
      .onConflictDoUpdate({ target: schema.notificationPreferences.userId, set: { ...input, updatedAt: new Date() } as any })
      .returning();
    return row;
  },

  /** Fan out one notification envelope to enabled channels, respecting prefs + quiet hours.
   *  Writes in-app row only if the inApp preference is enabled (or the type is critical). */
  async dispatch(envelope: NotificationEnvelope) {
    const locale = envelope.locale ?? 'en';
    // Fix the rendered.title/body logic: the previous check
    // `envelope.title && envelope.body` was wrong — an empty-string body
    // falsy-coerced to "no body provided" and called renderTemplate,
    // overwriting the explicitly-provided title. Now we check for nullish
    // (not falsy), so empty strings are preserved.
    const rendered = (envelope.title != null && envelope.body != null)
      ? { title: envelope.title, body: envelope.body }
      : renderTemplate(envelope.type, locale, envelope.data);

    const prefsRow = await engagementService.getPreferences(envelope.userId);
    const typePrefs = { ...DEFAULT_PREFS, ...(prefsRow.prefs as any)?.[envelope.type] };
    const critical = CRITICAL_TYPES.includes(envelope.type);
    const quiet = !critical && isQuietHours(prefsRow.quietHoursStart, prefsRow.quietHoursEnd);

    // Honor the inApp preference — the previous implementation always
    // wrote the in-app row, ignoring the user's `inApp: false` setting.
    // Critical notifications bypass the inApp preference (they're things
    // the user must see, like payment failures).
    let row = null;
    if (critical || typePrefs.inApp) {
      [row] = await db.insert(schema.notifications).values({
        userId: envelope.userId, type: envelope.type, title: rendered.title, body: rendered.body, link: envelope.link,
      }).returning();
    }

    // Insert all outbox events in a single multi-row insert — the previous
    // implementation issued 1-3 separate inserts, partially dispatching if
    // any failed mid-way.
    const events: Array<{ channel: 'push' | 'sms' | 'email'; payload: any }> = [];
    if (typePrefs.push && !quiet) {
      events.push({ channel: 'push', payload: { userId: envelope.userId, title: rendered.title, body: rendered.body, link: envelope.link } });
    }
    if (typePrefs.sms && (critical || !quiet)) {
      events.push({ channel: 'sms', payload: { userId: envelope.userId, body: `${rendered.title}: ${rendered.body}` } });
    }
    if (typePrefs.email && (critical || !quiet)) {
      events.push({ channel: 'email', payload: { userId: envelope.userId, subject: rendered.title, body: rendered.body } });
    }
    if (events.length > 0) {
      await db.insert(schema.outboxEvents).values(events as any);
    }

    return row;
  },

  async listForUser(userId: string, limit: number, cursor?: string) {
    const { decodeCursor, encodeCursor } = await import('../../src/pagination');
    const after = decodeCursor(cursor);
    const rows = await db.select().from(schema.notifications)
      .where(and(eq(schema.notifications.userId, userId), after ? lt(schema.notifications.id, after) : undefined))
      .orderBy(sql`${schema.notifications.createdAt} desc`).limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { rows: page, cursor: hasMore ? encodeCursor(page[page.length - 1].id) : undefined };
  },
  async unreadCount(userId: string) {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.notifications)
      .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
    return count;
  },
  async markRead(userId: string, id: string) {
    await db.update(schema.notifications).set({ readAt: new Date() }).where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, userId)));
  },
  async remove(userId: string, id: string) {
    await db.delete(schema.notifications).where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, userId)));
  },
};
