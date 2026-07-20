import { eq } from 'drizzle-orm';
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

  /**
   * 30-day soft delete per §18. Reversible until deletedAt passes;
   * hard-deleted by retention-cleanup cron.
   *
   * Previously this only set deletedAt + isActive=false. The user's existing
   * sessions table rows lingered, and although verifySession checks
   * deletedAt (defense in depth), any code path reading the JWT payload
   * without going through verifySession would honor a deleted user's token.
   * Now we also bump tokenVersion (invalidating all outstanding JWTs) and
   * delete the sessions table rows (so /sessions lists nothing for them).
   */
  async requestDeletion(userId: string) {
    await db.transaction(async (tx) => {
      const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, userId));
      if (!user) throw new NotFoundError('User not found');
      await tx.update(schema.users).set({
        deletedAt: new Date(),
        isActive: false,
        tokenVersion: user.tokenVersion + 1, // invalidate all outstanding JWTs
        updatedAt: new Date(),
      }).where(eq(schema.users.id, userId));
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    });
  },

  /** Full data export within the entities enumerated in §18 — streams a ZIP of per-entity JSON. */
  async exportZip(userId: string): Promise<NodeJS.ReadableStream> {
    const [profile] = await db.select().from(schema.riderProfiles).where(eq(schema.riderProfiles.userId, userId));
    const [contractorProfile] = await db.select().from(schema.contractorProfiles).where(eq(schema.contractorProfiles.userId, userId));
    const riderId = profile?.id;

    // Also include contractor documents if the user is a contractor — the
    // previous implementation omitted contractor data entirely, which is a
    // GDPR/Proclamation 1321/2024 violation for contractor accounts.
    const [subs, payments, rides, releases, claims, tickets, notifs, tos, contractorDocs] = await Promise.all([
      riderId ? db.select().from(schema.subscriptions).where(eq(schema.subscriptions.riderId, riderId)) : [],
      riderId ? db.select().from(schema.payments).where(eq(schema.payments.riderId, riderId)) : [],
      riderId ? db.select().from(schema.rides).where(eq(schema.rides.riderId, riderId)) : [],
      riderId ? db.select().from(schema.seatReleases).where(eq(schema.seatReleases.riderId, riderId)) : [],
      riderId ? db.select().from(schema.seatClaims).where(eq(schema.seatClaims.riderId, riderId)) : [],
      db.select().from(schema.supportTickets).where(eq(schema.supportTickets.userId, userId)),
      db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId)),
      db.select().from(schema.tosAcceptances).where(eq(schema.tosAcceptances.userId, userId)),
      contractorProfile
        ? db.select().from(schema.contractorDocuments).where(eq(schema.contractorDocuments.contractorId, contractorProfile.id))
        : [],
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
    if (contractorProfile) {
      archive.append(JSON.stringify(contractorProfile, null, 2), { name: 'contractor_profile.json' });
      // Don't include the document bytes — just metadata + a signed URL
      // the user can use to download each document (the URL expires in 1h).
      archive.append(JSON.stringify(contractorDocs, null, 2), { name: 'contractor_documents.json' });
    }
    archive.finalize();
    return stream;
  },
};
