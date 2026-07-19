import { getSession } from '../../src/context';
import { TypedHono } from '../../src/typed-hono';
import { z } from 'zod';
import { requireRole } from '../../src/middleware/auth';
import { documentService } from './documents';
import { BadRequestError, NotFoundError } from '@addis/shared';
import { db, schema } from '@addis/db';
import { eq } from 'drizzle-orm';

export const documentRoutes = new TypedHono();

const DocType = z.enum(['registration', 'insurance', 'inspection']);

/** Max upload size — checked BEFORE buffering the body into memory. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

async function contractorIdForUser(userId: string) {
  const [p] = await db.select().from(schema.contractorProfiles).where(eq(schema.contractorProfiles.userId, userId));
  if (!p) throw new NotFoundError('Contractor profile not found');
  return p.id;
}

documentRoutes.get('/documents', requireRole('contractor'), async (c) => {
  const contractorId = await contractorIdForUser(getSession(c).userId);
  return c.json({ data: await documentService.list(contractorId) });
});

documentRoutes.post('/documents', requireRole('contractor'), async (c) => {
  // Check Content-Length up front — previously the 10MB limit was only enforced
  // AFTER c.req.formData() had already buffered the whole file into memory,
  // allowing a malicious client to OOM the process by sending a huge body.
  const contentLength = Number(c.req.header('content-length') ?? '0');
  if (contentLength > MAX_UPLOAD_BYTES + 1024) { // +1KB for form metadata overhead
    throw new BadRequestError(`Upload exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit`);
  }
  const contractorId = await contractorIdForUser(getSession(c).userId);
  const form = await c.req.formData();
  const file = form.get('file') as File;
  if (!file) throw new BadRequestError('Missing file');
  // Double-check the actual file size (Content-Length can be missing or spoofed).
  if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestError(`File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit`);
  const type = DocType.parse(form.get('type'));
  const buffer = Buffer.from(await file.arrayBuffer());
  const doc = await documentService.upload(contractorId, { type, filename: file.name, buffer });
  return c.json({ data: doc }, 201);
});

documentRoutes.get('/documents/:id', requireRole('contractor', 'platform_admin'), async (c) => {
  const session = getSession(c);
  const requesterContractorId = session.role === 'platform_admin' ? null : await contractorIdForUser(session.userId);
  const url = await documentService.signedDownloadUrl(c.req.param('id'), requesterContractorId);
  return c.json({ data: { url } });
});

documentRoutes.delete('/documents/:id', requireRole('contractor', 'platform_admin'), async (c) => {
  const session = getSession(c);
  const requesterContractorId = session.role === 'platform_admin' ? null : await contractorIdForUser(session.userId);
  await documentService.remove(requesterContractorId, c.req.param('id'));
  return c.body(null, 204);
});
