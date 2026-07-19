// FIX (ARCH-003): Migrated from bare `Hono()` to `TypedOpenAPIHono` so this
// module is OpenAPI-capable and `c.get('session')` / `c.get('requestId')` /
// `c.get('logger')` are typed. Existing .post/.get/.patch/.delete calls
// continue to work; they can be incrementally converted to
// .openapi(createRoute(...), handler) to appear in the OpenAPI document.
import { TypedOpenAPIHono } from '../../src/typed-hono';
import { requireRole } from '../../src/middleware/auth';
import { catalogService } from './service';
import { CreateRouteInput, UpdateRouteInput, CreateShuttleInput, UpdateShuttleInput } from './types';

export const catalogRoutes = new TypedOpenAPIHono();

// Public
catalogRoutes.get('/routes', async (c) => {
  // FIX (API-003): Use the shared parseLimit() helper (1..100 clamp) instead
  // of raw `Number(c.req.query('limit') ?? 20)`, which accepted ?limit=99999999
  // and forced a huge table scan.
  const { parseLimit } = await import('../../src/limit');
  const limit = parseLimit(c.req.query('limit'));
  const { rows, cursor } = await catalogService.listRoutes(limit, c.req.query('cursor'));
  return c.json({ data: rows, meta: { cursor, limit } });
});
catalogRoutes.get('/routes/:id', async (c) => c.json({ data: await catalogService.getRoute(c.req.param('id')) }));
catalogRoutes.get('/plans', async (c) => c.json({ data: await catalogService.listPlans() }));

// Admin — mounted at /api/v1/admin/*
export const adminCatalogRoutes = new TypedOpenAPIHono();
adminCatalogRoutes.use('*', requireRole('platform_admin'));

adminCatalogRoutes.post('/routes', async (c) => {
  const body = CreateRouteInput.parse(await c.req.json());
  return c.json({ data: await catalogService.createRoute(body) }, 201);
});
adminCatalogRoutes.patch('/routes/:id', async (c) => {
  const body = UpdateRouteInput.parse(await c.req.json());
  return c.json({ data: await catalogService.updateRoute(c.req.param('id'), body) });
});
adminCatalogRoutes.delete('/routes/:id', async (c) => { await catalogService.deleteRoute(c.req.param('id')); return c.body(null, 204); });

adminCatalogRoutes.post('/shuttles', async (c) => {
  const body = CreateShuttleInput.parse(await c.req.json());
  return c.json({ data: await catalogService.createShuttle(body) }, 201);
});
adminCatalogRoutes.patch('/shuttles/:id', async (c) => {
  const body = UpdateShuttleInput.parse(await c.req.json());
  return c.json({ data: await catalogService.updateShuttle(c.req.param('id'), body) });
});
adminCatalogRoutes.delete('/shuttles/:id', async (c) => { await catalogService.deleteShuttle(c.req.param('id')); return c.body(null, 204); });
