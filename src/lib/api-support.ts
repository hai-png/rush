// Support — tickets + messages.
import { db } from '@/lib/db';
import { z } from 'zod';
import { NotFoundError, ForbiddenError } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { enqueueNotification } from '@/lib/outbox';

export async function GET_list({ session }: any) {
  const tickets = await db.supportTicket.findMany({
    where: session.role === 'platform_admin' ? {} : { userId: session.id },
    include: { _count: { select: { messages: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });
  return { data: tickets };
}

const CreateInput = z.object({
  subject: z.string().min(3).max(200),
  category: z.enum(['general', 'billing', 'route', 'shuttle', 'account', 'corporate', 'other']).default('general'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  body: z.string().min(1).max(10_000),
  subscriptionId: z.string().optional(),
  paymentId: z.string().optional(),
});

export async function POST_create({ session, body, ipAddress, userAgent }: any) {
  const input = CreateInput.parse(body);
  const ticket = await db.$transaction(async (tx) => {
    const t = await tx.supportTicket.create({
      data: {
        userId: session.id,
        subject: input.subject,
        category: input.category,
        priority: input.priority,
        subscriptionId: input.subscriptionId,
        paymentId: input.paymentId,
        status: 'open',
      },
    });
    await tx.ticketMessage.create({
      data: { ticketId: t.id, authorId: session.id, body: input.body },
    });
    return t;
  });
  await audit({
    actorId: session.id,
    action: 'ticket.created',
    entityType: 'support_ticket',
    entityId: ticket.id,
    after: { subject: input.subject },
    ipAddress, userAgent,
  });
  return { status: 201, data: ticket };
}

export async function GET_one({ session, params }: any) {
  const ticket = await db.supportTicket.findUnique({
    where: { id: params.id },
    include: { messages: { orderBy: { createdAt: 'asc' }, include: { author: { select: { id: true, name: true, role: true } } } } },
  });
  if (!ticket) throw new NotFoundError('Ticket not found');
  if (ticket.userId !== session.id && session.role !== 'platform_admin') {
    throw new ForbiddenError('Not your ticket');
  }
  return { data: ticket };
}

const MessageInput = z.object({ body: z.string().min(1).max(10_000) });

export async function POST_message({ session, params, body }: any) {
  const input = MessageInput.parse(body);
  const ticket = await db.supportTicket.findUnique({ where: { id: params.id } });
  if (!ticket) throw new NotFoundError('Ticket not found');
  if (ticket.userId !== session.id && session.role !== 'platform_admin') {
    throw new ForbiddenError('Not your ticket');
  }

  const msg = await db.$transaction(async (tx) => {
    const m = await tx.ticketMessage.create({
      data: { ticketId: params.id, authorId: session.id, body: input.body },
    });
    if (session.role === 'platform_admin' && ticket.status !== 'closed') {
      await tx.supportTicket.update({ where: { id: params.id }, data: { status: 'in_progress' } });
    }
    return m;
  });

  // Notify the other party.
  const notifyUserId = session.role === 'platform_admin' ? ticket.userId : undefined;
  if (notifyUserId) {
    await enqueueNotification({
      userId: notifyUserId,
      type: 'support_reply',
      title: 'New reply on your ticket',
      body: input.body.slice(0, 100),
      link: `/tickets/${ticket.id}`,
    });
  }
  return { status: 201, data: msg };
}
