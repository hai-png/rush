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
    // Escape LIKE wildcards in the search input so a search for '%' doesn't
    // match everything. The previous implementation interpolated raw search
    // into `%${search}%` — a search for '%' returned all rows, '_' matched
    // any single char, etc. Now we escape them.
    const escapeLike = (s: string) => s.replace(/[%_\\]/g, c => `\\${c}`);
    const escaped = search ? escapeLike(search) : undefined;
    const where = escaped ? or(ilike(schema.users.name, `%${escaped}%`), ilike(schema.users.phone, `%${escaped}%`)) : undefined;
    const rows = await db.select().from(schema.users).where(where).limit(limit);
    // Never return credential material to the admin UI, even to platform_admin.
    return rows.map(({ passwordHash: _ph, twoFactorSecret: _tfs, ...safe }) => safe);
  },

  async suspendUser(adminId: string, userId: string, ipAddress?: string) {
    return db.transaction(async (tx) => {
      // Self-protection: an admin should not be able to suspend their own
      // account — they'd lock themselves out with no recovery path. The
      // previous implementation had no such check.
      if (adminId === userId) throw new ForbiddenError('Cannot suspend your own account');
      const [before] = await tx.select().from(schema.users).where(eq(schema.users.id, userId));
      if (!before) throw new NotFoundError('User not found');
      const [after] = await tx.update(schema.users).set({ isActive: false, tokenVersion: before.tokenVersion + 1, updatedAt: new Date() }).where(eq(schema.users.id, userId)).returning();
      // Revoke all of the suspended user's sessions immediately.
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
      await writeAudit(tx as any, { actorId: adminId, action: 'user.suspended', entityType: 'user', entityId: userId, before, after, ipAddress });
      return after;
    });
  },

  async changeRole(adminId: string, userId: string, role: string, ipAddress?: string) {
    return db.transaction(async (tx) => {
      // Self-protection: an admin changing their own role could lock
      // themselves out of the admin UI (e.g. demoting self to rider).
      if (adminId === userId) throw new ForbiddenError('Cannot change your own role');
      // H15 fix: forbid escalation to platform_admin. A compromised platform_admin
      // could otherwise grant platform_admin to any user (or to a second account
      // they control), establishing persistent backdoor access. Promotions to
      // platform_admin should require a separate break-glass flow (out of scope
      // here) — the day-to-day changeRole route must refuse this target role.
      // Demotions FROM platform_admin are allowed (the self-protection check
      // above blocks demoting yourself; demoting another admin is fine).
      if (role === 'platform_admin') {
        throw new ForbiddenError('Cannot promote to platform_admin via this endpoint — use the break-glass flow');
      }
      const [before] = await tx.select().from(schema.users).where(eq(schema.users.id, userId));
      if (!before) throw new NotFoundError('User not found');
      const [after] = await tx.update(schema.users).set({ role: role as any, tokenVersion: before.tokenVersion + 1, updatedAt: new Date() }).where(eq(schema.users.id, userId)).returning();
      await writeAudit(tx as any, { actorId: adminId, action: 'user.role_changed', entityType: 'user', entityId: userId, before, after, ipAddress });
      return after;
    });
  },

  /**
   * Impersonation mints a real session token for another user and is one of the most
   * dangerous admin capabilities in the system, so it gets two extra checks beyond the
   * `requireRole('platform_admin')` already applied at the router level:
   *   1. The calling admin must actually have 2FA enabled — enforced in
   *      requireRole via TWO_FA_REQUIRED_ROLES (was previously just a
   *      comment that nothing enforced).
   *   2. A platform_admin may never impersonate another platform_admin — otherwise a single
   *      compromised admin account is a path to full control of every other admin account.
   *   3. The session row is now marked as an impersonation session
   *      (impersonatedBy column on the sessions table, when present), so
   *      the audit trail shows the admin's identity even after the JWT
   *      expires. Previously the impersonatedBy claim was in the JWT but
   *      never propagated to the session, making impersonation invisible
   *      in /sessions listings.
   */
  async impersonate(adminId: string, targetUserId: string, ipAddress?: string) {
    const [admin] = await db.select().from(schema.users).where(eq(schema.users.id, adminId));
    if (!admin?.twoFactorEnabled) throw new ForbiddenError('Impersonation requires the calling admin to have 2FA enabled');
    if (adminId === targetUserId) throw new ForbiddenError('Cannot impersonate yourself');

    const [target] = await db.select().from(schema.users).where(eq(schema.users.id, targetUserId));
    if (!target) throw new NotFoundError('User not found');
    if (target.role === 'platform_admin') throw new ForbiddenError('Cannot impersonate another platform_admin');

    const jti = createId();
    const env = (await import('@addis/shared')).loadEnv();
    const token = await new SignJWT({ id: target.id, role: target.role, phone: target.phone, tokenVersion: target.tokenVersion, jti, impersonatedBy: adminId })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('15m').sign(new TextEncoder().encode(env.NEXTAUTH_SECRET));
    await db.transaction(async (tx) => {
      await tx.insert(schema.sessions).values({
        userId: target.id, jti, impersonatedBy: adminId,
        userAgent: null,
        ipAddress,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      });
      await writeAudit(tx as any, { actorId: adminId, action: 'user.impersonated', entityType: 'user', entityId: targetUserId, after: { targetUserId, jti }, ipAddress });
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
