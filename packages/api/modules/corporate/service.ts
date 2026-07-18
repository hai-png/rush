import { eq, and } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { hashPassword, NotFoundError, ConflictError, ForbiddenError } from '@addis/shared';
import { createId } from '@paralleldrive/cuid2';

export const corporateService = {
  async signup(input: { corpName: string; corpCode: string; contactEmail: string; contactPhone: string; adminName: string; adminPassword: string; subsidyPercent: number; monthlySeatAllowance: number }) {
    return db.transaction(async (tx) => {
      const [admin] = await tx.insert(schema.users).values({
        phone: input.contactPhone, name: input.adminName, passwordHash: await hashPassword(input.adminPassword), role: 'corporate_admin', phoneVerified: false,
      }).returning();
      const [corp] = await tx.insert(schema.corporates).values({
        code: input.corpCode, name: input.corpName, contactEmail: input.contactEmail, contactPhone: input.contactPhone,
        subsidyPercent: input.subsidyPercent, monthlySeatAllowance: input.monthlySeatAllowance, adminUserId: admin.id,
      }).returning();
      return { corp, admin };
    });
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
    await db.delete(schema.corporateMembers).where(eq(schema.corporateMembers.id, memberId));
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

  async generateInvite(adminUserId: string) {
    const corp = await corporateService.getOwn(adminUserId);
    return { inviteUrl: `${process.env.NEXTAUTH_URL}/signup/rider?corp=${corp.code}`, code: corp.code };
  },
};
