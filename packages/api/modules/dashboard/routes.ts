import { getSession } from '../../src/context';
import { TypedHono } from '../../src/typed-hono';
import { requireRole } from '../../src/middleware/auth';
import { dashboardService } from './service';

export const dashboardRoutes = new TypedHono();
dashboardRoutes.get('/rider', requireRole('rider'), async (c) => c.json({ data: await dashboardService.rider(getSession(c).userId) }));
dashboardRoutes.get('/rider/active-trip', requireRole('rider'), async (c) => c.json({ data: await dashboardService.riderActiveTrip(getSession(c).userId, c.req.query('subscriptionId')!) }));
dashboardRoutes.get('/contractor', requireRole('contractor'), async (c) => c.json({ data: await dashboardService.contractor(getSession(c).userId) }));
dashboardRoutes.get('/corporate', requireRole('corporate_admin'), async (c) => c.json({ data: await dashboardService.corporate(getSession(c).userId) }));
