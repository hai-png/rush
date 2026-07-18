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

corporateRoutes.get('/', requireRole('corporate_admin'), async (c) => c.json({ data: await corporateService.getOwn(c.get('session').userId) }));
corporateRoutes.patch('/', requireRole('corporate_admin'), async (c) => c.json({ data: await corporateService.updateOwn(c.get('session').userId, await c.req.json()) }));

corporateRoutes.get('/members', requireRole('corporate_admin'), async (c) => c.json({ data: await corporateService.listMembers(c.get('session').userId) }));
corporateRoutes.patch('/members/:id', requireRole('corporate_admin'), async (c) => c.json({ data: await corporateService.updateMember(c.get('session').userId, c.req.param('id'), await c.req.json()) }));
corporateRoutes.delete('/members/:id', requireRole('corporate_admin'), async (c) => { await corporateService.removeMember(c.get('session').userId, c.req.param('id')); return c.body(null, 204); });

corporateRoutes.post('/invites', requireRole('corporate_admin'), async (c) => c.json({ data: await corporateService.generateInvite(c.get('session').userId) }));

corporateRoutes.post('/onboard', requireRole('rider'), async (c) => {
  const body = z.object({ corporateCode: z.string(), employeeId: z.string() }).parse(await c.req.json());
  return c.json({ data: await corporateService.onboardRider(c.get('session').userId, body) }, 201);
});
corporateRoutes.get('/me', requireRole('rider'), async (c) => c.json({ data: await corporateService.myMembership(c.get('session').userId) }));
