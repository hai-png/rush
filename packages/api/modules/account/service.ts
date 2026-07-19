import { and, eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { NotFoundError } from '@addis/shared';
import { ACCOUNT_DELETION_GRACE_DAYS } from '@addis/shared';
import archiver from 'archiver';
import { PassThrough } from 'node:stream';

export const accountService = {
  async get(userId: string) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!user) throw new NotFoundError('User not found');
    const [profile] = await db.select().from(schema.riderProfiles).where(eq(schema.riderProfiles.userId, userId));
    const { passwordHash: _ph, twoFactorSecret: _tfs, ...safeUser } = user;
    return { ...safeUser, profile };
  },

  async update(userId: string, input: { name?: string | undefined; homeArea?: string | undefined; workArea?: string | undefined }) {
    if (input.name) await db.update(schema.users).set({ name: input.name, updatedAt: new Date() }).where(eq(schema.users.id, userId));
    if (input.homeArea || input.workArea) {
      await db.update(schema.riderProfiles).set({
        ...(input.homeArea ? { homeArea: input.homeArea } : {}),
        ...(input.workArea ? { workArea: input.workArea } : {}),
        updatedAt: new Date(),
      }).where(eq(schema.riderProfiles.userId, userId));
    }
    return accountService.get(userId);
  },

  /** 30-day soft delete per §18. Reversible until deletedAt passes; hard-deleted by retention-cleanup cron. */
  async requestDeletion(userId: string) {
    await db.update(schema.users).set({ deletedAt: new Date(), isActive: false }).where(eq(schema.users.id, userId));
  },

  /** Full data export within the entities enumerated in §18 — streams a ZIP of per-entity JSON. */
  async exportZip(userId: string): Promise<NodeJS.ReadableStream> {
    const [profile] = await db.select().from(schema.riderProfiles).where(eq(schema.riderProfiles.userId, userId));
    const riderId = profile?.id;

    const [subs, payments, rides, releases, claims, tickets, notifs, tos] = await Promise.all([
      riderId ? db.select().from(schema.subscriptions).where(eq(schema.subscriptions.riderId, riderId)) : [],
      riderId ? db.select().from(schema.payments).where(eq(schema.payments.riderId, riderId)) : [],
      riderId ? db.select().from(schema.rides).where(eq(schema.rides.riderId, riderId)) : [],
      riderId ? db.select().from(schema.seatReleases).where(eq(schema.seatReleases.riderId, riderId)) : [],
      riderId ? db.select().from(schema.seatClaims).where(eq(schema.seatClaims.riderId, riderId)) : [],
      db.select().from(schema.supportTickets).where(eq(schema.supportTickets.userId, userId)),
      db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId)),
      db.select().from(schema.tosAcceptances).where(eq(schema.tosAcceptances.userId, userId)),
    ]);

    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = new PassThrough();
    archive.pipe(stream);
    archive.append(JSON.stringify(subs, null, 2), { name: 'subscriptions.json' });
    archive.append(JSON.stringify(payments, null, 2), { name: 'payments.json' });
    archive.append(JSON.stringify(rides, null, 2), { name: 'rides.json' });
    archive.append(JSON.stringify(releases, null, 2), { name: 'seat_releases.json' });
    archive.append(JSON.stringify(claims, null, 2), { name: 'seat_claims.json' });
    archive.append(JSON.stringify(tickets, null, 2), { name: 'tickets.json' });
    archive.append(JSON.stringify(notifs, null, 2), { name: 'notifications.json' });
    archive.append(JSON.stringify(tos, null, 2), { name: 'tos_acceptances.json' });
    archive.finalize();
    return stream;
  },
};
