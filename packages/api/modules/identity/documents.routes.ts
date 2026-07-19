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
  const contractorId = await contractorIdForUser(getSession(c).userId);
  const form = await c.req.formData();
  const file = form.get('file') as File;
  if (!file) throw new BadRequestError('Missing file');
  const type = DocType.parse(form.get('type')); // never trust the client-declared doc type as-is
  const buffer = Buffer.from(await file.arrayBuffer());
  const doc = await documentService.upload(contractorId, { type, filename: file.name, buffer });
  return c.json({ data: doc }, 201);
});

documentRoutes.get('/documents/:id', requireRole('contractor', 'platform_admin'), async (c) => {
  const session = getSession(c);
  // platform_admin may view any contractor's documents; a contractor may only view their own.
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
