import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';
import { NotFoundError, ForbiddenError, toErrorEnvelope } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { enqueueNotification } from '@/lib/outbox';
import { saveFile, FileUploadError } from '@/lib/file-storage';

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

  // Notify the other party: admin replies notify the rider; rider replies
  // notify all platform admins (so they know to look at the ticket).
  if (session.role === 'platform_admin') {
    await enqueueNotification({
      userId: ticket.userId,
      type: 'support_reply',
      title: 'New reply on your ticket',
      body: input.body.slice(0, 100),
      link: `/tickets/${ticket.id}`,
    });
  } else {
    // Rider replied — notify all platform admins.
    const admins = await db.user.findMany({
      where: { role: 'platform_admin', isActive: true },
      select: { id: true },
    });
    for (const a of admins) {
      await enqueueNotification({
        userId: a.id,
        type: 'support_reply',
        title: `Rider replied to ticket: ${ticket.subject}`,
        body: input.body.slice(0, 100),
        link: `/admin/tickets`,
      }).catch(() => {});
    }
  }
  return { status: 201, data: msg };
}

export async function handleTicketMessageWithAttachment(req: NextRequest, session: any, params: any): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  try {
    if (!session) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required', requestId } }, { status: 401 });
    }
    const ticket = await db.supportTicket.findUnique({ where: { id: params.id } });
    if (!ticket) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Ticket not found', requestId } }, { status: 404 });
    if (ticket.userId !== session.id && session.role !== 'platform_admin') {
      return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Not your ticket', requestId } }, { status: 403 });
    }

    const formData = await req.formData();
    const bodyText = formData.get('body') as string;
    const file = formData.get('file');

    if (!bodyText || bodyText.length < 1) {
      return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Message body required', requestId } }, { status: 400 });
    }

    let fileId: string | undefined;
    if (file && file instanceof File) {
      const meta = await saveFile(file, `tickets/${ticket.id}`);
      const uploaded = await db.uploadedFile.create({
        data: {
          uploaderId: session.id,
          originalFilename: meta.originalFilename,
          storageKey: meta.storageKey,
          mimeType: meta.mimeType,
          sizeBytes: meta.sizeBytes,
          checksumSha256: meta.checksumSha256,
          scanStatus: 'clean',
        },
      });
      fileId = uploaded.id;
    }

    const msg = await db.$transaction(async (tx) => {
      const m = await tx.ticketMessage.create({
        data: { ticketId: params.id, authorId: session.id, body: bodyText, fileId },
        include: { file: true },
      });
      if (session.role === 'platform_admin' && ticket.status !== 'closed') {
        await tx.supportTicket.update({ where: { id: params.id }, data: { status: 'in_progress' } });
      }
      return m;
    });

    const notifyUserId = session.role === 'platform_admin' ? ticket.userId : undefined;
    if (notifyUserId) {
      await enqueueNotification({
        userId: notifyUserId,
        type: 'support_reply',
        title: 'New reply on your ticket',
        body: bodyText.slice(0, 100),
        link: `/tickets/${ticket.id}`,
      });
    }

    return NextResponse.json({ data: msg }, { status: 201 });
  } catch (err) {
    if (err instanceof FileUploadError) {
      return NextResponse.json({ error: { code: 'BAD_REQUEST', message: err.message, requestId } }, { status: 400 });
    }
    const { status, body } = toErrorEnvelope(err, requestId);
    return NextResponse.json(body, { status });
  }
}


const TicketUpdateInput = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  category: z.enum(['general', 'billing', 'route', 'shuttle', 'account', 'corporate', 'other']).optional(),
});

export async function PATCH_ticket({ session, params, body, ipAddress, userAgent }: any) {
  const input = TicketUpdateInput.parse(body);
  const ticket = await db.supportTicket.findUnique({ where: { id: params.id } });
  if (!ticket) throw new NotFoundError('Ticket not found');
  if (ticket.userId !== session.id && session.role !== 'platform_admin') {
    throw new ForbiddenError('Not your ticket');
  }
  // Riders can only close their own tickets; only admin can set in_progress/resolved.
  if (session.role !== 'platform_admin' && input.status && input.status !== 'closed') {
    throw new ForbiddenError('Only admin can set that status');
  }
  const updated = await db.supportTicket.update({ where: { id: params.id }, data: input });
  await audit({ actorId: session.id, action: 'ticket.updated', entityType: 'support_ticket', entityId: params.id, after: input, ipAddress, userAgent });
  return { data: updated };
}

export async function GET_messages({ session, params }: any) {
  const ticket = await db.supportTicket.findUnique({ where: { id: params.id } });
  if (!ticket) throw new NotFoundError('Ticket not found');
  if (ticket.userId !== session.id && session.role !== 'platform_admin') {
    throw new ForbiddenError('Not your ticket');
  }
  const messages = await db.ticketMessage.findMany({
    where: { ticketId: params.id },
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { id: true, name: true, role: true } }, file: true },
  });
  return { data: messages };
}
