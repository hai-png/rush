import { Hono } from 'hono';
import { z } from 'zod';
import { requireRole } from '../../src/middleware/auth';
import { corporateService } from './service';

export const corporateRoutes = new Hono();

corporateRoutes.post('/signup', async (c) => {
  const body = z.object({
    corpName: z.string(), corpCode: z.string().min(2), contactEmail: z.string().email(), contactPhone: z.string(),
    adminName: z.string(), adminPassword: z.string().min(10),
    subsidyPercent: z.number().min(0).max(100).default(50), monthlySeatAllowance: z.number().int().positive().default(20),
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

/**
 * Member status update — only approvalStatus and isActive are mutable through this endpoint.
 *
 * Previously the handler passed the raw request body straight into updateMember(), which
 * spreads `...input` into a DB `.set({ ...input })` — a mass-assignment vulnerability.
 * A corporate_admin could send `{"corporateId":"<other-corp>","userId":"<attacker>","ridesUsedThisMonth":-100}`
 * and overwrite fields they should not be able to touch (e.g. move a member to a different
 * corporate, change the linked user, or zero out the ride counter). The strict zod schema
 * below rejects any field other than approvalStatus and isActive before it reaches the service.
 */
const UpdateMemberInput = z.object({
  approvalStatus: z.enum(['approved', 'rejected', 'pending']).optional(),
  isActive: z.boolean().optional(),
}).strict();

corporateRoutes.patch('/members/:id', requireRole('corporate_admin'), async (c) => c.json({ data: await corporateService.updateMember(c.get('session').userId, c.req.param('id'), UpdateMemberInput.parse(await c.req.json())) }));
corporateRoutes.delete('/members/:id', requireRole('corporate_admin'), async (c) => { await corporateService.removeMember(c.get('session').userId, c.req.param('id')); return c.body(null, 204); });

corporateRoutes.post('/invites', requireRole('corporate_admin'), async (c) => c.json({ data: await corporateService.generateInvite(c.get('session').userId) }));

corporateRoutes.post('/onboard', requireRole('rider'), async (c) => {
  const body = z.object({ corporateCode: z.string(), employeeId: z.string() }).parse(await c.req.json());
  return c.json({ data: await corporateService.onboardRider(c.get('session').userId, body) }, 201);
});
corporateRoutes.get('/me', requireRole('rider'), async (c) => c.json({ data: await corporateService.myMembership(c.get('session').userId) }));
