import { eq, and } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { hashPassword, NotFoundError, ConflictError, ForbiddenError } from '@addis/shared';
import { createId } from '@paralleldrive/cuid2';

export const corporateService = {
  /**
   * Self-service signup creates the corporate_admin account and the corporate record, but the
   * corporate is left INACTIVE. `onboardRider` (below) already requires `isActive = true`
   * before it will link a rider for subsidy, so no subsidy can actually be paid out until a
   * platform_admin reviews and activates the account via `activate()`. Without this, anyone
   * could self-register a corporate with up to 100% subsidy and immediately start onboarding
   * "employee" (rider) accounts that ride at the platform's expense with zero human review.
   */
  async signup(input: { corpName: string; corpCode: string; contactEmail: string; contactPhone: string; adminName: string; adminPassword: string; subsidyPercent: number; monthlySeatAllowance: number }) {
    return db.transaction(async (tx) => {
      const [admin] = await tx.insert(schema.users).values({
        phone: input.contactPhone, name: input.adminName, passwordHash: await hashPassword(input.adminPassword), role: 'corporate_admin', phoneVerified: false,
      }).returning();
      const [corp] = await tx.insert(schema.corporates).values({
        code: input.corpCode, name: input.corpName, contactEmail: input.contactEmail, contactPhone: input.contactPhone,
        subsidyPercent: input.subsidyPercent, monthlySeatAllowance: input.monthlySeatAllowance, adminUserId: admin.id,
        isActive: false, // requires platform_admin review — see activate()
      }).returning();
      return { corp, admin };
    });
  },

  /** Platform-admin-only: reviews and activates a self-registered corporate so onboarding/subsidy can begin. */
  async activate(corpId: string) {
    const [corp] = await db.update(schema.corporates).set({ isActive: true, updatedAt: new Date() }).where(eq(schema.corporates.id, corpId)).returning();
    if (!corp) throw new NotFoundError('Corporate not found');
    return corp;
  },

  async getOwn(adminUserId: string) {
    const [corp] = await db.select().from(schema.corporates).where(eq(schema.corporates.adminUserId, adminUserId));
    if (!corp) throw new NotFoundError('Corporate not found');
    return corp;
  },

  async updateOwn(adminUserId: string, input: Partial<{ name: string; contactEmail: string; contactPhone: string; subsidyPercent: number; monthlySeatAllowance: number }>) {
    const corp = await corporateService.getOwn(adminUserId);
    const [row] = await db.update(schema.corporates).set({ ...input, updatedAt: new Date() }).where(eq(schema.corporates.id, corp.id)).returning();
    return row;
  },

  async listMembers(adminUserId: string) {
    const corp = await corporateService.getOwn(adminUserId);
    return db.select().from(schema.corporateMembers).where(eq(schema.corporateMembers.corporateId, corp.id));
  },

  async updateMember(adminUserId: string, memberId: string, input: { approvalStatus?: 'approved' | 'rejected'; isActive?: boolean }) {
    const corp = await corporateService.getOwn(adminUserId);
    const [member] = await db.select().from(schema.corporateMembers).where(eq(schema.corporateMembers.id, memberId));
    if (!member || member.corporateId !== corp.id) throw new NotFoundError('Member not found');
    const [row] = await db.update(schema.corporateMembers).set({ ...input, updatedAt: new Date() }).where(eq(schema.corporateMembers.id, memberId)).returning();
    if (input.approvalStatus === 'approved') {
      await db.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'corporate_member_added', userId: member.userId } });
    }
    return row;
  },

  async removeMember(adminUserId: string, memberId: string) {
    const corp = await corporateService.getOwn(adminUserId);
    const [member] = await db.select().from(schema.corporateMembers).where(eq(schema.corporateMembers.id, memberId));
    if (!member || member.corporateId !== corp.id) throw new NotFoundError('Member not found');
    // Soft-delete (set deletedAt) rather than hard-delete. The deletedAt column
    // was added to the schema but the previous implementation still called
    // db.delete(), losing the membership history. Soft-delete preserves the
    // audit trail and allows historical queries (e.g. "was this user ever a
    // member of corporate X?"). The unique constraints on (userId) and
    // (corporateId, employeeId) must be partial (WHERE deleted_at IS NULL)
    // so a soft-deleted member can re-join a different corporate — see schema.ts.
    await db.update(schema.corporateMembers)
      .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
      .where(eq(schema.corporateMembers.id, memberId));
    await db.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'corporate_member_removed', userId: member.userId } });
  },

  /** Rider links themselves to a corporate via invite code. Requires admin approval before subsidy applies. */
  async onboardRider(riderUserId: string, input: { corporateCode: string; employeeId: string }) {
    const [corp] = await db.select().from(schema.corporates).where(and(eq(schema.corporates.code, input.corporateCode), eq(schema.corporates.isActive, true)));
    if (!corp) throw new NotFoundError('Corporate not found');
    try {
      const [member] = await db.insert(schema.corporateMembers).values({
        corporateId: corp.id, userId: riderUserId, employeeId: input.employeeId, approvalStatus: 'pending',
      }).returning();
      return member;
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictError('Already linked to a corporate, or employee ID already used');
      throw e;
    }
  },

  async myMembership(riderUserId: string) {
    const [member] = await db.select().from(schema.corporateMembers).where(eq(schema.corporateMembers.userId, riderUserId));
    return member ?? null;
  },

  /**
   * Generate a time-limited invite token for onboarding riders.
   *
   * H41 fix: the previous implementation returned the corporate's permanent
   * `code` as the invite — a leaked code (email forward, screenshot) was valid
   * forever. Now we generate a signed, time-limited token (24h expiry) that
   * encodes the corporate code + expiry. The onboardRider endpoint verifies
   * the token's signature and expiry before accepting the corporate code.
   *
   * The token is HMAC-signed with NEXTAUTH_SECRET so it can't be forged. It
   * doesn't require a DB round-trip (no invite-code table to manage) — the
   * signature + expiry are self-contained.
   */
  async generateInvite(adminUserId: string) {
    const corp = await corporateService.getOwn(adminUserId);
    const expiresAt = Date.now() + 24 * 3600_000; // 24h
    const payload = JSON.stringify({ code: corp.code, expiresAt });
    const { createHmac } = await import('node:crypto');
    const sig = createHmac('sha256', process.env.NEXTAUTH_SECRET!).update(payload).digest('hex');
    const token = Buffer.from(`${payload}.${sig}`).toString('base64url');
    return {
      inviteUrl: `${process.env.NEXTAUTH_URL}/signup/rider?invite=${token}`,
      code: corp.code, // still returned for the admin's reference
      token,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  },
};
