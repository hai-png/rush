import { and, eq, lt } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { NotFoundError, ForbiddenError } from '@addis/shared';
import { ticketState } from './state';

export const supportService = {
  async createTicket(userId: string, input: { subject: string; body: string; category: string; subscriptionId?: string | undefined; paymentId?: string | undefined }) {
    const [ticket] = await db.insert(schema.supportTickets).values({ userId, ...input } as any).returning();
    await db.insert(schema.outboxEvents).values({ channel: 'audit', payload: { action: 'ticket.created', entityId: ticket.id } });
    return ticket;
  },

  async listForUser(userId: string, isStaff: boolean) {
    if (isStaff) return db.select().from(schema.supportTickets).orderBy(schema.supportTickets.createdAt);
    return db.select().from(schema.supportTickets).where(eq(schema.supportTickets.userId, userId));
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

      await tx.insert(schema.ticketMessages).values({ ticketId, authorId, body, isStaff });

      if (isStaff && ticket.status === 'open') {
        const t = ticketState.resolve('open', 'staff.replied');
        await tx.update(schema.supportTickets).set({
          status: t.to, firstResponseAt: ticket.firstResponseAt ?? new Date(), assignedToId: ticket.assignedToId ?? authorId, updatedAt: new Date(),
        }).where(eq(schema.supportTickets.id, ticketId));
        await tx.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'support_reply', userId: ticket.userId } });
      }
    });
  },

  async setStatus(adminId: string, ticketId: string, event: 'staff.resolved' | 'user.reopened') {
    const [ticket] = await db.select().from(schema.supportTickets).where(eq(schema.supportTickets.id, ticketId));
    if (!ticket) throw new NotFoundError('Ticket not found');
    const t = ticketState.resolve(ticket.status, event);
    await db.update(schema.supportTickets).set({
      status: t.to,
      resolvedAt: t.to === 'resolved' ? new Date() : ticket.resolvedAt,
      updatedAt: new Date(),
    }).where(eq(schema.supportTickets.id, ticketId));
    if (t.to === 'resolved') await db.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'support_resolved', userId: ticket.userId } });
    return t;
  },

  /** Cron: auto-close resolved tickets after 7 days of no reopen. */
  async autoCloseStale() {
    return db.update(schema.supportTickets).set({ status: 'closed', closedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.supportTickets.status, 'resolved'), lt(schema.supportTickets.resolvedAt, new Date(Date.now() - 7 * 86400_000))))
      .returning({ id: schema.supportTickets.id });
  },
};

export const faqService = {
  async list(category?: string) {
    const where = category ? and(eq(schema.faqArticles.isActive, true), eq(schema.faqArticles.category, category as any)) : eq(schema.faqArticles.isActive, true);
    return db.select().from(schema.faqArticles).where(where).orderBy(schema.faqArticles.sortOrder);
  },
  async create(input: any) { const [row] = await db.insert(schema.faqArticles).values(input).returning(); return row; },
  async update(id: string, input: any) {
    const [row] = await db.update(schema.faqArticles).set({ ...input, updatedAt: new Date() }).where(eq(schema.faqArticles.id, id)).returning();
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
