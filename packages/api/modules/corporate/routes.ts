import { TypedOpenAPIHono } from '../../src/typed-hono';
import { z } from 'zod';
import { requireRole } from '../../src/middleware/auth';
import { corporateService } from './service';
import { db, schema } from '@addis/db';
import { verifySignature } from '../../src/pagination';

export const corporateRoutes = new TypedOpenAPIHono();

corporateRoutes.post('/signup', async (c) => {
  const body = z.object({
    corpName: z.string().min(2).max(200),
    corpCode: z.string().min(2).max(50).regex(/^[A-Z0-9-]+$/, 'corpCode must be uppercase alphanumeric with dashes'),
    contactEmail: z.string().email(),
    contactPhone: z.string().regex(/^\+251[97]\d{8}$/, 'contactPhone must be an Ethiopian phone (+2519... or +2517...)'),
    adminName: z.string().min(2).max(200),
    adminPassword: z.string().min(10).max(1000),
    subsidyPercent: z.number().min(0).max(100).default(50),
    monthlySeatAllowance: z.number().int().positive().max(10000).default(20),
  }).parse(await c.req.json());
  return c.json({ data: await corporateService.signup(body) }, 201);
});

const UpdateCorporateInput = z.object({
  name: z.string().min(2).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
}).strict();

corporateRoutes.get('/', requireRole('corporate_admin'), async (c) => c.json({ data: await corporateService.getOwn(c.get('session')!.userId) }));
corporateRoutes.patch('/', requireRole('corporate_admin'), async (c) => c.json({ data: await corporateService.updateOwn(c.get('session')!.userId, UpdateCorporateInput.parse(await c.req.json()) as any) }));

corporateRoutes.get('/members', requireRole('corporate_admin'), async (c) => c.json({ data: await corporateService.listMembers(c.get('session')!.userId) }));

const UpdateMemberInput = z.object({
  approvalStatus: z.enum(['approved', 'rejected', 'pending']).optional(),
  isActive: z.boolean().optional(),
}).strict();

corporateRoutes.patch('/members/:id', requireRole('corporate_admin'), async (c) => {
  const body = UpdateMemberInput.parse(await c.req.json());
  return c.json({ data: await corporateService.updateMember(c.get('session')!.userId, c.req.param('id'), body as any) });
});
corporateRoutes.delete('/members/:id', requireRole('corporate_admin'), async (c) => { await corporateService.removeMember(c.get('session')!.userId, c.req.param('id')); return c.body(null, 204); });

corporateRoutes.post('/invites', requireRole('corporate_admin'), async (c) => c.json({ data: await corporateService.generateInvite(c.get('session')!.userId) }));

corporateRoutes.post('/onboard', requireRole('rider'), async (c) => {

  const body = z.object({
    invite: z.string(),
    employeeId: z.string(),
  }).parse(await c.req.json());

  let code: string;

  const { loadEnv } = await import('@addis/shared');
  const env = loadEnv();
  const decoded = Buffer.from(body.invite, 'base64url').toString();
  const lastDot = decoded.lastIndexOf('.');
  if (lastDot < 0) return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid invite token', requestId: c.get('requestId') } }, 400);
  const payload = decoded.slice(0, lastDot);
  const sig = decoded.slice(lastDot + 1);
  if (!verifySignature(payload, sig, env.NEXTAUTH_SECRET)) {
    try {
      await db.insert(schema.outboxEvents).values({
        channel: 'audit',
        payload: {
          action: 'corporate.invite_signature_mismatch',
          entityId: c.get('session')!.userId,
          after: { payloadPrefix: payload.slice(0, 50) },
        },
      });
    } catch {}
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid invite signature', requestId: c.get('requestId') } }, 400);
  }
  let parsed: { code?: string; expiresAt?: number };
  try {
    parsed = JSON.parse(payload);
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Malformed invite token', requestId: c.get('requestId') } }, 400);
  }
  if (typeof parsed.expiresAt !== 'number' || Date.now() > parsed.expiresAt) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invite token expired', requestId: c.get('requestId') } }, 400);
  }
  if (typeof parsed.code !== 'string' || !parsed.code) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invite token missing code', requestId: c.get('requestId') } }, 400);
  }
  code = parsed.code;

  return c.json({ data: await corporateService.onboardRider(c.get('session')!.userId, { corporateCode: code, employeeId: body.employeeId }) }, 201);
});
corporateRoutes.get('/me', requireRole('rider'), async (c) => c.json({ data: await corporateService.myMembership(c.get('session')!.userId) }));
