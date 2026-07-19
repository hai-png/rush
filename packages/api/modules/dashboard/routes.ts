import { TypedOpenAPIHono } from '../../src/typed-hono';
import { requireRole } from '../../src/middleware/auth';
import { dashboardService } from './service';

export const dashboardRoutes = new TypedOpenAPIHono();
dashboardRoutes.get('/rider', requireRole('rider'), async (c) => c.json({ data: await dashboardService.rider(c.get('session').userId) }));
dashboardRoutes.get('/rider/active-trip', requireRole('rider'), async (c) => c.json({ data: await dashboardService.riderActiveTrip(c.get('session').userId, c.req.query('subscriptionId')!) }));
dashboardRoutes.get('/contractor', requireRole('contractor'), async (c) => c.json({ data: await dashboardService.contractor(c.get('session').userId) }));
dashboardRoutes.get('/corporate', requireRole('corporate_admin'), async (c) => c.json({ data: await dashboardService.corporate(c.get('session').userId) }));
