import { and, eq, gte, sql } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { NotFoundError, ForbiddenError } from '@addis/shared';
import { SignJWT } from 'jose';
import { createId } from '@paralleldrive/cuid2';
import { writeAudit } from './audit';

export const adminService = {
  async dashboard() {
    const [activeSubs] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.subscriptions).where(eq(schema.subscriptions.status, 'active'));
    const [openSeats] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.seatReleases).where(eq(schema.seatReleases.status, 'open'));
    const [pendingContractors] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.contractorProfiles).where(eq(schema.contractorProfiles.verificationStatus, 'pending'));
    const [revenue30d] = await db.select({ sum: sql<string>`coalesce(sum(amount), 0)` }).from(schema.payments)
      .where(and(eq(schema.payments.status, 'completed'), gte(schema.payments.createdAt, sql`now() - interval '30 days'`)));
    const [openTickets] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.supportTickets).where(eq(schema.supportTickets.status, 'open'));
    return { activeSubscriptions: activeSubs.n, openSeatReleases: openSeats.n, pendingContractorVerifications: pendingContractors.n, revenueLast30dETB: revenue30d.sum, openTickets: openTickets.n };
  },

  async listUsers(limit: number, search?: string) {
    const { ilike, or } = await import('drizzle-orm');
    const where = search ? or(ilike(schema.users.name, `%${search}%`), ilike(schema.users.phone, `%${search}%`)) : undefined;
    const rows = await db.select().from(schema.users).where(where).limit(limit);
    // Never return credential material to the admin UI, even to platform_admin.
    return rows.map(({ passwordHash: _ph, twoFactorSecret: _tfs, ...safe }) => safe);
  },

  async suspendUser(adminId: string, userId: string, ipAddress?: string) {
    return db.transaction(async (tx) => {
      const [before] = await tx.select().from(schema.users).where(eq(schema.users.id, userId));
      if (!before) throw new NotFoundError('User not found');
      const [after] = await tx.update(schema.users).set({ isActive: false, tokenVersion: before.tokenVersion + 1, updatedAt: new Date() }).where(eq(schema.users.id, userId)).returning();
      await writeAudit(tx as any, { actorId: adminId, action: 'user.suspended', entityType: 'user', entityId: userId, before, after, ipAddress });
      return after;
    });
  },

  async changeRole(adminId: string, userId: string, role: string, ipAddress?: string) {
    return db.transaction(async (tx) => {
      const [before] = await tx.select().from(schema.users).where(eq(schema.users.id, userId));
      if (!before) throw new NotFoundError('User not found');
      const [after] = await tx.update(schema.users).set({ role: role as any, tokenVersion: before.tokenVersion + 1, updatedAt: new Date() }).where(eq(schema.users.id, userId)).returning();
      await writeAudit(tx as any, { actorId: adminId, action: 'user.role_changed', entityType: 'user', entityId: userId, before, after, ipAddress });
      return after;
    });
  },

  /** Impersonation: short-lived (15min) token, mandatory audit entry, requires caller already passed 2FA-gated route. */
  /**
   * Impersonation mints a real session token for another user and is one of the most
   * dangerous admin capabilities in the system, so it gets two extra checks beyond the
   * `requireRole('platform_admin')` already applied at the router level:
   *   1. The calling admin must actually have 2FA enabled — this was previously just a
   *      comment ("requires caller already passed 2FA-gated route") that nothing enforced;
   *      requireRole never checks 2FA, and login() previously didn't either (fixed
   *      separately), so a platform_admin session obtained via password alone could
   *      impersonate anyone.
   *   2. A platform_admin may never impersonate another platform_admin — otherwise a single
   *      compromised admin account is a path to full control of every other admin account.
   */
  async impersonate(adminId: string, targetUserId: string, ipAddress?: string) {
    const [admin] = await db.select().from(schema.users).where(eq(schema.users.id, adminId));
    if (!admin?.twoFactorEnabled) throw new ForbiddenError('Impersonation requires the calling admin to have 2FA enabled');
    if (adminId === targetUserId) throw new ForbiddenError('Cannot impersonate yourself');

    const [target] = await db.select().from(schema.users).where(eq(schema.users.id, targetUserId));
    if (!target) throw new NotFoundError('User not found');
    if (target.role === 'platform_admin') throw new ForbiddenError('Cannot impersonate another platform_admin');

    const jti = createId();
    const token = await new SignJWT({ id: target.id, role: target.role, phone: target.phone, tokenVersion: target.tokenVersion, jti, impersonatedBy: adminId })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('15m').sign(new TextEncoder().encode(process.env.NEXTAUTH_SECRET!));
    await db.transaction(async (tx) => {
      await tx.insert(schema.sessions).values({ userId: target.id, jti, expiresAt: new Date(Date.now() + 15 * 60_000) });
      await writeAudit(tx as any, { actorId: adminId, action: 'user.impersonated', entityType: 'user', entityId: targetUserId, ipAddress });
    });
    return { accessToken: token, expiresIn: 900 };
  },

  async searchAuditLogs(filters: { entityType?: string; actorId?: string; action?: string }, limit: number) {
    const conditions = [] as any[];
    if (filters.entityType) conditions.push(eq(schema.auditLogs.entityType, filters.entityType));
    if (filters.actorId) conditions.push(eq(schema.auditLogs.actorId, filters.actorId));
    if (filters.action) conditions.push(eq(schema.auditLogs.action, filters.action));
    return db.select().from(schema.auditLogs).where(conditions.length ? and(...conditions) : undefined).orderBy(sql`created_at desc`).limit(limit);
  },
};
