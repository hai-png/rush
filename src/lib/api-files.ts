
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readFileBytes } from '@/lib/file-storage';
import { NotFoundError, ForbiddenError, toErrorEnvelope } from '@/lib/errors';

// File download handler:
//   - Sanitize filename for Content-Disposition (strip CR/LF, escape quotes).
//   - Set X-Content-Type-Options: nosniff so browsers don't sniff HTML.
//   - Allow ticket participants to view each other's attachments.
//   - Use 'attachment' instead of 'inline' for untrusted uploads to prevent
//     the browser from rendering them in-page.

function sanitizeFilename(name: string): string {
  // Strip CR/LF (header injection), control chars, and quotes.
  // RFC 6266 suggests filename*=UTF-8''<percent-encoded> for non-ASCII.
  const safe = name.replace(/[\r\n"\u0000-\u001f]/g, '_').slice(0, 200);
  return safe;
}

function percentEncodeFilename(name: string): string {
  return encodeURIComponent(name).replace(/['()]/g, escape).replace(/\*/g, '%2A');
}

export async function handleFileDownload(req: NextRequest, session: any, params: { id: string }): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  try {
    if (!session) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required', requestId } }, { status: 401 });
    }
    const fileId = params.id;
    const file = await db.uploadedFile.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundError('File not found');

    const isOwner = file.uploaderId === session.id;
    const isAdmin = session.role === 'platform_admin';

    // allow ticket participants to view attachments on tickets they're part of.
    let isTicketParticipant = false;
    if (!isOwner && !isAdmin) {
      const ticketMsg = await db.ticketMessage.findFirst({
        where: { fileId: file.id },
        select: { ticket: { select: { userId: true } } },
      });
      if (ticketMsg && ticketMsg.ticket.userId === session.id) {
        isTicketParticipant = true;
      }
    }

    // allow contractors to view their own documents (covered by isOwner)
    // and platform_admins to view any (covered by isAdmin). For contractor docs
    // that another contractor shouldn't see, the isOwner check suffices.

    if (!isOwner && !isAdmin && !isTicketParticipant) {
      throw new ForbiddenError('Not allowed to access this file');
    }

    const bytes = await readFileBytes(file.storageKey);
    const safeName = sanitizeFilename(file.originalFilename);
    const encodedName = percentEncodeFilename(safeName);

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'content-type': file.mimeType,
        'content-length': String(file.sizeBytes),
        // attachment (not inline) prevents the browser from rendering untrusted
        // content in-page. filename* is the RFC 6266 UTF-8 form; filename is the
        // ASCII fallback.
        'content-disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`,
        // prevent MIME sniffing — browsers must respect the declared
        // content-type and not sniff HTML/script out of a binary blob.
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    const { status, body } = toErrorEnvelope(err, requestId);
    return NextResponse.json(body, { status });
  }
}
