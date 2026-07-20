import { and, eq, lt } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { NotFoundError, ForbiddenError, BadRequestError } from '@addis/shared';
import { z } from 'zod';
import { ticketState } from './state';

export const supportService = {

  async createTicket(userId: string, input: { subject: string; body: string; category: string; subscriptionId?: string; paymentId?: string }) {
    if (input.subscriptionId) {
      const [profile] = await db.select().from(schema.riderProfiles).where(eq(schema.riderProfiles.userId, userId));
      if (!profile) throw new BadRequestError('Rider profile not found');
      const [sub] = await db.select().from(schema.subscriptions)
        .where(and(eq(schema.subscriptions.id, input.subscriptionId), eq(schema.subscriptions.riderId, profile.id))).limit(1);
      if (!sub) throw new ForbiddenError('Subscription does not belong to this rider');
    }
    if (input.paymentId) {
      const [profile] = await db.select().from(schema.riderProfiles).where(eq(schema.riderProfiles.userId, userId));
      if (!profile) throw new BadRequestError('Rider profile not found');
      const [payment] = await db.select().from(schema.payments)
        .where(and(eq(schema.payments.id, input.paymentId), eq(schema.payments.riderId, profile.id))).limit(1);
      if (!payment) throw new ForbiddenError('Payment does not belong to this rider');
    }
    const [ticket] = await db.insert(schema.supportTickets).values({ userId, ...input } as any).returning();
    await db.insert(schema.outboxEvents).values({ channel: 'audit', payload: { action: 'ticket.created', entityId: ticket.id, actorId: userId } });
    return ticket;
  },

  async listForUser(userId: string, isStaff: boolean, opts?: { limit?: number }) {

    const rawLimit = opts?.limit ?? 50;
    const limit = Math.min(Math.max(1, Math.trunc(rawLimit)), 500);
    if (isStaff) return db.select().from(schema.supportTickets).orderBy(schema.supportTickets.createdAt).limit(limit);
    return db.select().from(schema.supportTickets)
      .where(eq(schema.supportTickets.userId, userId))
      .orderBy(schema.supportTickets.createdAt)
      .limit(limit);
  },

  async getTicket(userId: string, isStaff: boolean, ticketId: string) {
    const [t] = await db.select().from(schema.supportTickets).where(eq(schema.supportTickets.id, ticketId));
    if (!t) throw new NotFoundError('Ticket not found');
    if (!isStaff && t.userId !== userId) throw new ForbiddenError();
    return t;
  },

  async reply(authorId: string, isStaff: boolean, ticketId: string, body: string) {
    return db.transaction(async (tx) => {
      const [ticket] = await tx.select().from(schema.supportTickets).where(eq(schema.supportTickets.id, ticketId));
      if (!ticket) throw new NotFoundError('Ticket not found');
      if (!isStaff && ticket.userId !== authorId) throw new ForbiddenError('Not your ticket');

      await tx.insert(schema.ticketMessages).values({ ticketId, authorId, body, isStaff });

      if (isStaff && ticket.status === 'open') {
        const t = ticketState.resolve('open', 'staff.replied');
        await tx.update(schema.supportTickets).set({
          status: t.to, firstResponseAt: ticket.firstResponseAt ?? new Date(), assignedToId: ticket.assignedToId ?? authorId, updatedAt: new Date(),
        }).where(eq(schema.supportTickets.id, ticketId));
        await tx.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'support_reply', userId: ticket.userId } });
      } else if (!isStaff && (ticket.status === 'resolved' || ticket.status === 'closed')) {

        const t = ticketState.resolve(ticket.status, 'user.reopened');
        await tx.update(schema.supportTickets).set({
          status: t.to, resolvedAt: null, closedAt: null, updatedAt: new Date(),
        }).where(eq(schema.supportTickets.id, ticketId));
      }
    });
  },

  async setStatus(adminId: string, ticketId: string, event: 'staff.resolved' | 'user.reopened') {
    const [ticket] = await db.select().from(schema.supportTickets).where(eq(schema.supportTickets.id, ticketId));
    if (!ticket) throw new NotFoundError('Ticket not found');

    if (event === 'user.reopened' && ticket.userId !== adminId) {
      throw new ForbiddenError('Not your ticket');
    }
    const t = ticketState.resolve(ticket.status, event);

    await db.update(schema.supportTickets).set({
      status: t.to,
      resolvedAt: t.to === 'resolved' ? new Date() : ticket.resolvedAt,
      resolvedById: t.to === 'resolved' ? adminId : null,
      updatedAt: new Date(),
    }).where(eq(schema.supportTickets.id, ticketId));
    if (t.to === 'resolved') await db.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'support_resolved', userId: ticket.userId } });
    return t;
  },

  async autoCloseStale() {
    return db.update(schema.supportTickets).set({ status: 'closed', closedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.supportTickets.status, 'resolved'), lt(schema.supportTickets.resolvedAt, new Date(Date.now() - 7 * 86400_000))))
      .returning({ id: schema.supportTickets.id });
  },
};

const FaqInput = z.object({
  question: z.string().min(3).max(500),
  answer: z.string().min(1).max(5000),
  category: z.enum(['billing', 'routes', 'shuttle', 'account', 'corporate', 'general']),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  isActive: z.boolean().optional(),
}).strict();

export const faqService = {
  async list(category?: string) {
    const where = category ? and(eq(schema.faqArticles.isActive, true), eq(schema.faqArticles.category, category as any)) : eq(schema.faqArticles.isActive, true);
    return db.select().from(schema.faqArticles).where(where).orderBy(schema.faqArticles.sortOrder);
  },
  async create(input: unknown) {
    const data = FaqInput.parse(input);
    const [row] = await db.insert(schema.faqArticles).values(data).returning();
    return row;
  },
  async update(id: string, input: unknown) {
    const data = FaqInput.partial().parse(input);
    const [row] = await db.update(schema.faqArticles).set({ ...data, updatedAt: new Date() }).where(eq(schema.faqArticles.id, id)).returning();
    if (!row) throw new NotFoundError('FAQ article not found');
    return row;
  },
  async remove(id: string) { await db.update(schema.faqArticles).set({ isActive: false }).where(eq(schema.faqArticles.id, id)); },
  async vote(id: string, helpful: boolean) {
    const col = helpful ? schema.faqArticles.helpfulYes : schema.faqArticles.helpfulNo;
    const { sql } = await import('drizzle-orm');
    await db.update(schema.faqArticles).set({ [helpful ? 'helpfulYes' : 'helpfulNo']: sql`${col} + 1` } as any).where(eq(schema.faqArticles.id, id));
  },
};
