
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { saveFile, readFileBytes, FileUploadError } from '@/lib/file-storage';
import { NotFoundError, ForbiddenError, toErrorEnvelope } from '@/lib/errors';
import { audit } from '@/lib/audit';

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
    const contractorDoc = await db.contractorDocument.findFirst({ where: { fileId: file.id } });
    let canAccess = isOwner || isAdmin;
    if (contractorDoc && session.role === 'platform_admin') canAccess = true;

    if (!canAccess) throw new ForbiddenError('Not allowed to access this file');

    const bytes = await readFileBytes(file.storageKey);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'content-type': file.mimeType,
        'content-length': String(file.sizeBytes),
        'content-disposition': `inline; filename="${file.originalFilename}"`,
        'cache-control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    const { status, body } = toErrorEnvelope(err, requestId);
    return NextResponse.json(body, { status });
  }
}
