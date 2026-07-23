import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { hashPassword, NotFoundError, ConflictError } from '@addis/shared';

export const corporateService = {

  async signup(input: { corpName: string; corpCode: string; contactEmail: string; contactPhone: string; adminName: string; adminPassword: string; subsidyPercent: number; monthlySeatAllowance: number }) {
    return db.transaction(async (tx) => {
      const [admin] = await tx.insert(schema.users).values({
        phone: input.contactPhone, name: input.adminName, passwordHash: await hashPassword(input.adminPassword), role: 'corporate_admin', phoneVerified: false,
      }).returning();
      const [corp] = await tx.insert(schema.corporates).values({
        code: input.corpCode, name: input.corpName, contactEmail: input.contactEmail, contactPhone: input.contactPhone,
        subsidyPercent: input.subsidyPercent, monthlySeatAllowance: input.monthlySeatAllowance, adminUserId: admin!.id,
        isActive: false,
      }).returning();
      try {
        const { otpService } = await import('../identity/otp');
        await otpService.send(input.contactPhone, 'signup_verification');
      } catch {
      }
      return { corp, admin };
    });
  },

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

    await db.update(schema.corporateMembers)
      .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
      .where(eq(schema.corporateMembers.id, memberId));
    await db.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'corporate_member_removed', userId: member.userId } });
  },

  async onboardRider(riderUserId: string, input: { corporateCode: string; employeeId: string }) {
    const [corp] = await db.select().from(schema.corporates).where(and(eq(schema.corporates.code, input.corporateCode), eq(schema.corporates.isActive, true)));
    if (!corp) throw new NotFoundError('Corporate not found');
    const [existing] = await db.select().from(schema.corporateMembers)
      .where(and(eq(schema.corporateMembers.userId, riderUserId), sql`${schema.corporateMembers.deletedAt} is null`));
    if (existing) {
      const [existingCorp] = await db.select().from(schema.corporates).where(eq(schema.corporates.id, existing.corporateId));
      throw new ConflictError(
        `You are already linked to corporate "${existingCorp?.name ?? existing.corporateId}". Contact support if you believe this is an error.`,
      );
    }
    try {
      const [member] = await db.insert(schema.corporateMembers).values({
        corporateId: corp.id, userId: riderUserId, employeeId: input.employeeId, approvalStatus: 'pending',
      }).returning();
      return member;
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictError('Employee ID already used at this corporate');
      throw e;
    }
  },

  async myMembership(riderUserId: string) {
    const [member] = await db.select().from(schema.corporateMembers).where(eq(schema.corporateMembers.userId, riderUserId));
    return member ?? null;
  },

  async generateInvite(adminUserId: string) {
    const corp = await corporateService.getOwn(adminUserId);
    const expiresAt = Date.now() + 24 * 3600_000;
    const payload = JSON.stringify({ code: corp.code, expiresAt });
    const { createHmac } = await import('node:crypto');

    const env = (await import('@addis/shared')).loadEnv();
    const sig = createHmac('sha256', env.NEXTAUTH_SECRET).update(payload).digest('hex');
    const token = Buffer.from(`${payload}.${sig}`).toString('base64url');
    return {
      inviteUrl: `${env.NEXTAUTH_URL}/signup/rider?invite=${token}`,
      code: corp.code,
      token,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  },
};
