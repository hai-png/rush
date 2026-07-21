// File upload + download endpoints. Used by contractor onboarding documents
// and any future upload needs (corporate logos, support ticket attachments).
//
// Uploads are multipart/form-data; downloads are GET with auth.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { api } from '@/lib/api';
import { saveFile, readFileBytes, FileUploadError } from '@/lib/file-storage';
import { BadRequestError, NotFoundError, ForbiddenError, toErrorEnvelope } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { z } from 'zod';

// POST /api/v1/files/upload
// Multipart form-data with field "file" (the bytes).
// Returns { id, storageKey, originalFilename, mimeType, sizeBytes }.
export async function POST_upload({ session }: any) {
  // Note: api() middleware parsed JSON body, but for multipart we need the
  // raw request. We can't get it here easily, so this handler is wired up
  // as a raw route handler in the route table — see api-routes.ts which
  // calls it with the original NextRequest via a special case.
  throw new Error('POST_upload must be called via the multipart route handler');
}

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

// GET /api/v1/files/:id
// Streams the file content. Auth required; only the uploader (or a platform_admin)
// can download. Contractor docs are visible to admins too — see documents routes.
export async function handleFileDownload(req: NextRequest, session: any, params: { id: string }): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  try {
    if (!session) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required', requestId } }, { status: 401 });
    }
    const fileId = params.id;
    const file = await db.uploadedFile.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundError('File not found');

    // Permission: uploader, platform_admin, or (for contractor docs) any admin.
    const isOwner = file.uploaderId === session.id;
    const isAdmin = session.role === 'platform_admin';
    // Check if this file is a contractor document — if so, allow platform_admin.
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
