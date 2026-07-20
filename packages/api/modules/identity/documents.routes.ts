import { TypedOpenAPIHono } from '../../src/typed-hono';
import { z } from 'zod';
import { requireRole } from '../../src/middleware/auth';
import { documentService } from './documents';
import { BadRequestError, NotFoundError } from '@addis/shared';
import { db, schema } from '@addis/db';
import { eq } from 'drizzle-orm';

export const documentRoutes = new TypedOpenAPIHono();

const DocType = z.enum(['registration', 'insurance', 'inspection']);

async function contractorIdForUser(userId: string) {
  const [p] = await db.select().from(schema.contractorProfiles).where(eq(schema.contractorProfiles.userId, userId));
  if (!p) throw new NotFoundError('Contractor profile not found');
  return p.id;
}

documentRoutes.get('/documents', requireRole('contractor'), async (c) => {
  const contractorId = await contractorIdForUser(c.get('session').userId);
  return c.json({ data: await documentService.list(contractorId) });
});

documentRoutes.post('/documents', requireRole('contractor'), async (c) => {
  const contractorId = await contractorIdForUser(c.get('session').userId);
  const form = await c.req.formData();
  const file = form.get('file') as File;
  if (!file) throw new BadRequestError('Missing file');

  const MAX_SIZE_BYTES = 10 * 1024 * 1024;
  if (file.size > MAX_SIZE_BYTES) {
    throw new BadRequestError('File exceeds 10MB limit');
  }
  const type = DocType.parse(form.get('type'));
  const buffer = Buffer.from(await file.arrayBuffer());
  const doc = await documentService.upload(contractorId, { type, filename: file.name, buffer });
  return c.json({ data: doc }, 201);
});

documentRoutes.get('/documents/:id', requireRole('contractor', 'platform_admin'), async (c) => {
  const session = c.get('session');

  const requesterContractorId = session.role === 'platform_admin' ? null : await contractorIdForUser(session.userId);
  const url = await documentService.signedDownloadUrl(c.req.param('id'), requesterContractorId);
  return c.json({ data: { url } });
});

documentRoutes.delete('/documents/:id', requireRole('contractor', 'platform_admin'), async (c) => {
  const session = c.get('session');
  const requesterContractorId = session.role === 'platform_admin' ? null : await contractorIdForUser(session.userId);
  await documentService.remove(requesterContractorId, c.req.param('id'));
  return c.body(null, 204);
});
