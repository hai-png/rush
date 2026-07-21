// File upload + download endpoints. Used by contractor onboarding documents
// and support ticket attachments.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { saveFile, readFileBytes, FileUploadError } from '@/lib/file-storage';
import { NotFoundError, ForbiddenError, toErrorEnvelope } from '@/lib/errors';
import { audit } from '@/lib/audit';

// Standalone route handler for multipart upload (not via api() wrapper).
export async function handleFileUpload(req: NextRequest, session: any): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  try {
    if (!session) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required', requestId } }, { status: 401 });
    }
    const formData = await req.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'No "file" field in form data', requestId } }, { status: 400 });
    }
    const meta = await saveFile(file, 'uploads');
    const uploaded = await db.uploadedFile.create({
      data: {
        uploaderId: session.id,
        originalFilename: meta.originalFilename,
        storageKey: meta.storageKey,
        mimeType: meta.mimeType,
        sizeBytes: meta.sizeBytes,
        checksumSha256: meta.checksumSha256,
      },
    });
    await audit({
      actorId: session.id,
      action: 'file.uploaded',
      entityType: 'uploaded_file',
      entityId: uploaded.id,
      after: { filename: meta.originalFilename, sizeBytes: meta.sizeBytes, mimeType: meta.mimeType },
    });
    return NextResponse.json({ data: uploaded });
  } catch (err) {
    if (err instanceof FileUploadError) {
      return NextResponse.json({ error: { code: 'BAD_REQUEST', message: err.message, requestId } }, { status: 400 });
    }
    const { status, body } = toErrorEnvelope(err, requestId);
    return NextResponse.json(body, { status });
  }
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
