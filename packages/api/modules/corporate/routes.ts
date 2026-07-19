import { Hono } from 'hono';
import { z } from 'zod';
import { requireRole } from '../../src/middleware/auth';
import { corporateService } from './service';

export const corporateRoutes = new Hono();

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
  // Deliberately excludes subsidyPercent, monthlySeatAllowance, isActive, adminUserId, code —
  // a self-service corporate_admin must not be able to raise their own subsidy or flip their
  // own active/ownership state. The previous handler passed the raw request body straight
  // into a DB `.set({ ...input })`, which is a mass-assignment vulnerability: any field on the
  // corporates row could be overwritten by whatever JSON the caller sent, including subsidy
  // percentage or the admin-user pointer.
}).strict();

corporateRoutes.get('/', requireRole('corporate_admin'), async (c) => c.json({ data: await corporateService.getOwn(c.get('session').userId) }));
corporateRoutes.patch('/', requireRole('corporate_admin'), async (c) => c.json({ data: await corporateService.updateOwn(c.get('session').userId, UpdateCorporateInput.parse(await c.req.json())) }));

corporateRoutes.get('/members', requireRole('corporate_admin'), async (c) => c.json({ data: await corporateService.listMembers(c.get('session').userId) }));

// Strict schema for member updates — the previous route passed raw JSON
// straight to the service's `.set({ ...input })`, a mass-assignment
// vulnerability. A corporate admin could send
// `{ corporateId: "other-corp", userId: "attacker-id", ridesUsedThisMonth: 0 }`
// and the service would write all of it — moving a member to a different
// corporate, changing the user pointer, or resetting ride counts. Now only
// approvalStatus and isActive are accepted.
const UpdateMemberInput = z.object({
  approvalStatus: z.enum(['approved', 'rejected', 'pending']).optional(),
  isActive: z.boolean().optional(),
}).strict();

corporateRoutes.patch('/members/:id', requireRole('corporate_admin'), async (c) => {
  const body = UpdateMemberInput.parse(await c.req.json());
  return c.json({ data: await corporateService.updateMember(c.get('session').userId, c.req.param('id'), body) });
});
corporateRoutes.delete('/members/:id', requireRole('corporate_admin'), async (c) => { await corporateService.removeMember(c.get('session').userId, c.req.param('id')); return c.body(null, 204); });

corporateRoutes.post('/invites', requireRole('corporate_admin'), async (c) => c.json({ data: await corporateService.generateInvite(c.get('session').userId) }));

corporateRoutes.post('/onboard', requireRole('rider'), async (c) => {
  const body = z.object({
    /** Either a signed invite token (preferred — time-limited) or a raw
     *  corporate code (legacy — accepted for backward compat but logged). */
    invite: z.string().optional(),
    corporateCode: z.string().optional(),
    employeeId: z.string(),
  }).parse(await c.req.json());

  let code: string;
  if (body.invite) {
    // H41: verify the signed invite token (signature + expiry)
    const { timingSafeEqual, createHmac } = await import('node:crypto');
    const decoded = Buffer.from(body.invite, 'base64url').toString();
    const lastDot = decoded.lastIndexOf('.');
    if (lastDot < 0) return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid invite token', requestId: c.get('requestId') } }, 400);
    const payload = decoded.slice(0, lastDot);
    const sig = decoded.slice(lastDot + 1);
    const expected = createHmac('sha256', process.env.NEXTAUTH_SECRET!).update(payload).digest('hex');
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid invite signature', requestId: c.get('requestId') } }, 400);
    }
    const parsed = JSON.parse(payload);
    if (typeof parsed.expiresAt !== 'number' || Date.now() > parsed.expiresAt) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invite token expired', requestId: c.get('requestId') } }, 400);
    }
    code = parsed.code;
  } else if (body.corporateCode) {
    // Legacy: raw corporate code (no expiry). Accepted for backward compat
    // with old invite URLs, but new invites should use the signed token.
    code = body.corporateCode;
  } else {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Either invite or corporateCode is required', requestId: c.get('requestId') } }, 400);
  }

  return c.json({ data: await corporateService.onboardRider(c.get('session').userId, { corporateCode: code, employeeId: body.employeeId }) }, 201);
});
corporateRoutes.get('/me', requireRole('rider'), async (c) => c.json({ data: await corporateService.myMembership(c.get('session').userId) }));
