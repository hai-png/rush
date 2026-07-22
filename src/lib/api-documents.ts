
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { saveFile, FileUploadError } from '@/lib/file-storage';
import { BadRequestError, NotFoundError, ForbiddenError, ConflictError, toErrorEnvelope } from '@/lib/errors';
import { audit } from '@/lib/audit';

const DOC_TYPES = new Set(['registration', 'insurance', 'inspection']);

export async function handleDocumentUpload(req: NextRequest, session: any): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  try {
    if (!session) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required', requestId } }, { status: 401 });
    }
    if (session.role !== 'contractor' && session.role !== 'platform_admin') {
      return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Only contractors can upload documents', requestId } }, { status: 403 });
    }

    const profile = await db.contractorProfile.findUnique({ where: { userId: session.id } });
    if (!profile) throw new NotFoundError('Contractor profile not found');

    const formData = await req.formData();
    const type = formData.get('type') as string;
    const file = formData.get('file');

    if (!type || !DOC_TYPES.has(type)) {
      return NextResponse.json({ error: { code: 'BAD_REQUEST', message: `Invalid type (must be one of: ${[...DOC_TYPES].join(', ')})`, requestId } }, { status: 400 });
    }
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'No "file" field in form data', requestId } }, { status: 400 });
    }

    const existing = await db.contractorDocument.findUnique({
      where: { contractorId_type: { contractorId: profile.id, type } },
    });

    const meta = await saveFile(file, `contractor-docs/${profile.id}`);

    const doc = await db.$transaction(async (tx) => {
      const uploaded = await tx.uploadedFile.create({
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

      if (existing) {
        return tx.contractorDocument.update({
          where: { id: existing.id },
          data: { fileId: uploaded.id, uploadedAt: new Date() },
          include: { file: true },
        });
      }
      return tx.contractorDocument.create({
        data: {
          contractorId: profile.id,
          type,
          fileId: uploaded.id,
        },
        include: { file: true },
      });
    });

    if (profile.verificationStatus === 'unverified') {
      await db.contractorProfile.update({
        where: { id: profile.id },
        data: { verificationStatus: 'pending' },
      });
    }

    await audit({
      actorId: session.id,
      action: 'contractor.document_uploaded',
      entityType: 'contractor_document',
      entityId: doc.id,
      after: { type, fileId: doc.fileId, filename: meta.originalFilename },
    });

    return NextResponse.json({ data: doc }, { status: 201 });
  } catch (err) {
    if (err instanceof FileUploadError) {
      return NextResponse.json({ error: { code: 'BAD_REQUEST', message: err.message, requestId } }, { status: 400 });
    }
    if (err instanceof BadRequestError || err instanceof NotFoundError || err instanceof ForbiddenError || err instanceof ConflictError) {
      const { status, body } = toErrorEnvelope(err, requestId);
      return NextResponse.json(body, { status });
    }
    const { status, body } = toErrorEnvelope(err, requestId);
    return NextResponse.json(body, { status });
  }
}

export async function GET_documents({ session }: any) {
  if (session.role !== 'contractor' && session.role !== 'platform_admin') {
    throw new ForbiddenError('Only contractors can view their documents');
  }
  const profile = await db.contractorProfile.findUnique({
    where: { userId: session.id },
    include: { documents: { include: { file: true } } },
  });
  if (!profile) throw new NotFoundError('Contractor profile not found');
  return { data: profile.documents };
}

export async function GET_documents_for({ session, params }: any) {
  if (session.role !== 'platform_admin') throw new ForbiddenError('Admin only');
  const profile = await db.contractorProfile.findUnique({
    where: { id: params.contractorId },
    include: { documents: { include: { file: true } } },
  });
  if (!profile) throw new NotFoundError('Contractor not found');
  return { data: profile.documents };
}
