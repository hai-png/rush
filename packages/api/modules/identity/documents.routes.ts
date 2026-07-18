import { Hono } from 'hono';
import { requireRole } from '../../src/middleware/auth';
import { documentService } from './documents';
import { NotFoundError } from '@addis/shared';
import { db, schema } from '@addis/db';
import { eq } from 'drizzle-orm';

export const documentRoutes = new Hono();

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
  const type = form.get('type') as 'registration' | 'insurance' | 'inspection';
  const buffer = Buffer.from(await file.arrayBuffer());
  const doc = await documentService.upload(contractorId, { type, filename: file.name, buffer });
  return c.json({ data: doc }, 201);
});

documentRoutes.get('/documents/:id', requireRole('contractor', 'platform_admin'), async (c) => {
  const url = await documentService.signedDownloadUrl(c.req.param('id'));
  return c.json({ data: { url } });
});

documentRoutes.delete('/documents/:id', requireRole('contractor', 'platform_admin'), async (c) => {
  const contractorId = await contractorIdForUser(c.get('session').userId);
  await documentService.remove(contractorId, c.req.param('id'));
  return c.body(null, 204);
});
