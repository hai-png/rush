import { OpenAPIHono } from '@hono/zod-openapi';
import { requestContext } from './middleware/context';
import { errorHandler } from './middleware/error';
import { authMiddleware } from './middleware/auth';
import { idempotencyMiddleware } from './middleware/idempotency';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { tosGateMiddleware } from './middleware/tos-gate';

import { catalogRoutes } from '../modules/catalog/routes';
import { identityRoutes } from '../modules/identity/routes';
import { tosRoutes } from '../modules/tos/routes';
import { subscriptionRoutes } from '../modules/subscription/routes';
import { marketplaceRoutes } from '../modules/marketplace/routes';
import { operationsRoutes } from '../modules/operations/routes';
import { supportRoutes } from '../modules/support/routes';
import { corporateRoutes } from '../modules/corporate/routes';
import { adminRoutes } from '../modules/admin/routes';
import { cronRoutes } from '../modules/cron/routes';
import { webhookRoutes } from '../modules/webhooks/routes';
import { engagementRoutes } from '../modules/engagement/routes';
import { healthRoutes } from '../modules/health/routes';
import { metricsRoutes } from '../modules/health/metrics';
import { accountRoutes } from '../modules/account/routes';
import { dashboardRoutes } from '../modules/dashboard/routes';

export const app = new OpenAPIHono();

app.use('*', requestContext);
app.use('*', authMiddleware);       // populates c.get('session') if present; does not 401 by default
app.use('*', rateLimitMiddleware);  // must run after authMiddleware — several rules rate-limit per-user via c.get('session')
app.use('*', tosGateMiddleware);    // 409 if authenticated + stale ToS
app.use('/api/v1/*', idempotencyMiddleware); // POST only, internally

app.route('/api/v1', catalogRoutes);
app.route('/api/v1/auth', identityRoutes);
app.route('/api/v1/tos', tosRoutes);
app.route('/api/v1/subscriptions', subscriptionRoutes);
app.route('/api/v1', marketplaceRoutes); // seat-releases, seat-claims
app.route('/api/v1', operationsRoutes);  // trips, rides, shuttle-positions
app.route('/api/v1', supportRoutes);     // tickets, faq
app.route('/api/v1', engagementRoutes);   // notifications, announcements
app.route('/api/v1/corporate', corporateRoutes);
app.route('/api/v1/admin', adminRoutes);
app.route('/api/v1/cron', cronRoutes);
app.route('/api/v1/webhooks', webhookRoutes);
app.route('/api/v1', healthRoutes);       // /api/v1/health
app.route('/api/v1', metricsRoutes);      // /api/v1/metrics
app.route('/api/v1/account', accountRoutes);
app.route('/api/v1/dashboard', dashboardRoutes);

app.onError(errorHandler);

app.doc('/api/v1/openapi.json', { openapi: '3.1.0', info: { title: 'Addis Ride API', version: '1.0.0' } });

export type App = typeof app;
