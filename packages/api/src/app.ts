import { OpenAPIHono } from '@hono/zod-openapi';
import { requestContext } from './middleware/context';
import { errorHandler } from './middleware/error';
import { authMiddleware } from './middleware/auth';
import { idempotencyMiddleware } from './middleware/idempotency';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { tosGateMiddleware } from './middleware/tos-gate';

import { csrfProtection } from './middleware/csrf';

import { httpRequestDuration } from '../modules/health/metrics';

import { catalogRoutes } from '../modules/catalog/routes';
import { identityRoutes } from '../modules/identity/routes';
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
import { tosRoutes } from '../modules/tos/routes';

export const app = new OpenAPIHono();

app.use('*', requestContext);
app.use('*', authMiddleware);
app.use('*', csrfProtection);
app.use('*', rateLimitMiddleware);
app.use('*', tosGateMiddleware);
app.use('/api/v1/*', idempotencyMiddleware);

app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const durationSec = (Date.now() - start) / 1000;
  const route = c.req.path
    .replace(/\/[a-z0-9]{20,30}/g, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id');
  try {
    httpRequestDuration.labels(c.req.method, route, String(c.res.status)).observe(durationSec);
  } catch {}
});

app.route('/api/v1', catalogRoutes);
app.route('/api/v1/auth', identityRoutes);
app.route('/api/v1/subscriptions', subscriptionRoutes);
app.route('/api/v1', marketplaceRoutes);
app.route('/api/v1', operationsRoutes);
app.route('/api/v1', supportRoutes);
app.route('/api/v1', engagementRoutes);
app.route('/api/v1/corporate', corporateRoutes);
app.route('/api/v1/admin', adminRoutes);
app.route('/api/v1/cron', cronRoutes);
app.route('/api/v1/webhooks', webhookRoutes);
app.route('/api/v1', healthRoutes);
app.route('/api/v1', metricsRoutes);
app.route('/api/v1/account', accountRoutes);
app.route('/api/v1/dashboard', dashboardRoutes);
app.route('/api/v1/tos', tosRoutes);

app.onError(errorHandler);

app.doc('/api/v1/openapi.json', { openapi: '3.1.0', info: { title: 'Addis Ride API', version: '1.0.0' } });

export type App = typeof app;
