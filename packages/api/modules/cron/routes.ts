import { TypedOpenAPIHono } from '../../src/typed-hono';
import { timingSafeEqual } from 'node:crypto';
import { CRON_JOBS, withLock } from '../../src/cron-jobs';

export const cronRoutes = new TypedOpenAPIHono();

cronRoutes.use('*', async (c, next) => {
  const provided = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const expected = process.env.CRON_SECRET ?? '';
  if (expected.length < 32) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Cron secret not configured', requestId: c.get('requestId') } }, 401);
  const ok = provided.length === expected.length && timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!ok) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret', requestId: c.get('requestId') } }, 401);
  return await next();
});

for (const job of CRON_JOBS) {
  cronRoutes.post(`/${job.route}`, async (c) => {
    const result = await withLock(job.name, job.run);
    return c.json(result);
  });
}

cronRoutes.get('/', async (c) => {
  return c.json({
    data: CRON_JOBS.map((j) => ({
      name: j.name,
      route: `/api/v1/cron/${j.route}`,
      intervalMs: j.intervalMs,
    })),
  });
});
