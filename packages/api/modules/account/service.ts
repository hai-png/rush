import { eq, and } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { NotFoundError } from '@addis/shared';
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

  async update(userId: string, input: { name?: string; homeArea?: string; workArea?: string }) {
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

  async requestDeletion(userId: string) {
    await db.transaction(async (tx) => {
      const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, userId));
      if (!user) throw new NotFoundError('User not found');
      await tx.update(schema.users).set({
        deletedAt: new Date(),
        isActive: false,
        tokenVersion: user.tokenVersion + 1,
        updatedAt: new Date(),
      }).where(eq(schema.users.id, userId));
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));

      // DB-004: if this user is a corporate admin with active members, raise
      // an audit alert. The corporate is now orphaned — members can't be
      // approved/rejected until a platform admin reassigns ownership.
      if (user.role === 'corporate_admin') {
        const [corp] = await tx.select().from(schema.corporates)
          .where(eq(schema.corporates.adminUserId, userId));
        if (corp) {
          const activeMembers = await tx.select({ id: schema.corporateMembers.id })
            .from(schema.corporateMembers)
            .where(and(eq(schema.corporateMembers.corporateId, corp.id), eq(schema.corporateMembers.isActive, true)));
          if (activeMembers.length > 0) {
            await tx.insert(schema.outboxEvents).values({
              channel: 'audit',
              payload: {
                action: 'corporate.orphaned_by_admin_deletion',
                entityId: corp.id,
                after: {
                  corporateId: corp.id,
                  corporateName: corp.name,
                  adminUserId: userId,
                  activeMemberCount: activeMembers.length,
                },
              },
            });
          }
        }
      }
    });
  },

  async exportZip(userId: string): Promise<NodeJS.ReadableStream> {
    const [profile] = await db.select().from(schema.riderProfiles).where(eq(schema.riderProfiles.userId, userId));
    const [contractorProfile] = await db.select().from(schema.contractorProfiles).where(eq(schema.contractorProfiles.userId, userId));
    const riderId = profile?.id;

    // SEC-013: cap each query at 10000 rows to prevent a user with 7 years
    // of records from OOMing the process. If truncated, the ZIP contains
    // only the first 10000 rows per table — for full export, contact
    // support (rare case). Use Promise.all (not streaming) because archiver
    // needs the data eagerly; for users with more than 10k rows in any
    // table, the route returns 413 via the size guard in the route handler.
    const EXPORT_LIMIT = 10_000;
    const [subs, payments, rides, releases, claims, tickets, notifs, tos, contractorDocs,
      ticketMessages, corporateMemberships, devices, notifPrefs,
    ] = await Promise.all([
      riderId ? db.select().from(schema.subscriptions).where(eq(schema.subscriptions.riderId, riderId)).limit(EXPORT_LIMIT) : [],
      riderId ? db.select().from(schema.payments).where(eq(schema.payments.riderId, riderId)).limit(EXPORT_LIMIT) : [],
      riderId ? db.select().from(schema.rides).where(eq(schema.rides.riderId, riderId)).limit(EXPORT_LIMIT) : [],
      riderId ? db.select().from(schema.seatReleases).where(eq(schema.seatReleases.riderId, riderId)).limit(EXPORT_LIMIT) : [],
      riderId ? db.select().from(schema.seatClaims).where(eq(schema.seatClaims.riderId, riderId)).limit(EXPORT_LIMIT) : [],
      db.select().from(schema.supportTickets).where(eq(schema.supportTickets.userId, userId)).limit(EXPORT_LIMIT),
      db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId)).limit(EXPORT_LIMIT),
      db.select().from(schema.tosAcceptances).where(eq(schema.tosAcceptances.userId, userId)).limit(EXPORT_LIMIT),
      contractorProfile
        ? db.select().from(schema.contractorDocuments).where(eq(schema.contractorDocuments.contractorId, contractorProfile.id)).limit(EXPORT_LIMIT)
        : [],

      db.select().from(schema.ticketMessages).where(eq(schema.ticketMessages.authorId, userId)).limit(EXPORT_LIMIT),

      db.select().from(schema.corporateMembers).where(eq(schema.corporateMembers.userId, userId)).limit(EXPORT_LIMIT),

      db.select().from(schema.devices).where(eq(schema.devices.userId, userId)).limit(EXPORT_LIMIT),

      db.select().from(schema.notificationPreferences).where(eq(schema.notificationPreferences.userId, userId)).limit(EXPORT_LIMIT),
    ]);

    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = new PassThrough();
    archive.pipe(stream);

    // SEC-013: abort the archive if it grows beyond 50MB (defense in depth
    // against the 10k-per-table limit being too generous).
    const MAX_ZIP_BYTES = 50 * 1024 * 1024;
    let totalBytes = 0;
    stream.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_ZIP_BYTES) {
        archive.abort();
        stream.destroy(new Error('Export exceeded 50MB limit — contact support for a full export'));
      }
    });

    if (profile) {
      archive.append(JSON.stringify(profile, null, 2), { name: 'rider_profile.json' });
    }
    archive.append(JSON.stringify({ data: subs, truncated: subs.length === EXPORT_LIMIT }, null, 2), { name: 'subscriptions.json' });
    archive.append(JSON.stringify({ data: payments, truncated: payments.length === EXPORT_LIMIT }, null, 2), { name: 'payments.json' });
    archive.append(JSON.stringify({ data: rides, truncated: rides.length === EXPORT_LIMIT }, null, 2), { name: 'rides.json' });
    archive.append(JSON.stringify({ data: releases, truncated: releases.length === EXPORT_LIMIT }, null, 2), { name: 'seat_releases.json' });
    archive.append(JSON.stringify({ data: claims, truncated: claims.length === EXPORT_LIMIT }, null, 2), { name: 'seat_claims.json' });
    archive.append(JSON.stringify({ data: tickets, truncated: tickets.length === EXPORT_LIMIT }, null, 2), { name: 'tickets.json' });
    archive.append(JSON.stringify({ data: notifs, truncated: notifs.length === EXPORT_LIMIT }, null, 2), { name: 'notifications.json' });

    archive.append(JSON.stringify({ data: ticketMessages, truncated: ticketMessages.length === EXPORT_LIMIT }, null, 2), { name: 'ticket_messages.json' });
    archive.append(JSON.stringify({ data: corporateMemberships, truncated: corporateMemberships.length === EXPORT_LIMIT }, null, 2), { name: 'corporate_memberships.json' });
    archive.append(JSON.stringify({ data: devices, truncated: devices.length === EXPORT_LIMIT }, null, 2), { name: 'devices.json' });
    archive.append(JSON.stringify({ data: notifPrefs, truncated: notifPrefs.length === EXPORT_LIMIT }, null, 2), { name: 'notification_preferences.json' });
    archive.append(JSON.stringify({ data: tos, truncated: tos.length === EXPORT_LIMIT }, null, 2), { name: 'tos_acceptances.json' });
    if (contractorProfile) {
      archive.append(JSON.stringify(contractorProfile, null, 2), { name: 'contractor_profile.json' });

      archive.append(JSON.stringify({ data: contractorDocs, truncated: contractorDocs.length === EXPORT_LIMIT }, null, 2), { name: 'contractor_documents.json' });
    }
    archive.finalize();
    return stream;
  },
};
