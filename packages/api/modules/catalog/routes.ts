import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { TypedOpenAPIHono } from '../../src/typed-hono';
import { requireRole } from '../../src/middleware/auth';
import { catalogService } from './service';
import { CreateRouteInput, UpdateRouteInput, CreatePlanInput, UpdatePlanInput, CreateShuttleInput, UpdateShuttleInput } from './types';
import { envelope } from '@addis/shared';

/**
 * Both catalogRoutes and adminCatalogRoutes use TypedOpenAPIHono because every route
 * is declared via createRoute() and registered via .openapi() — this populates the
 * generated OpenAPI spec with auth requirements, request schemas, and response shapes.
 */
export const catalogRoutes = new TypedOpenAPIHono();

// ---------- Schemas ----------
const RouteSchema = z.object({
  id: z.string(),
  name: z.string(),
  origin: z.string(),
  destination: z.string(),
  fare: z.string(),
  durationMin: z.number(),
  isActive: z.boolean(),
}).passthrough();
const PlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  durationDays: z.number(),
  ridesIncluded: z.number(),
  priceETB: z.string(),
  isPopular: z.boolean(),
  isTrial: z.boolean(),
  isActive: z.boolean(),
}).passthrough();

// ---------- Public routes ----------
/**
 * These public read-only endpoints declare no security scheme in the OpenAPI spec —
 * they are reachable without authentication. The admin write endpoints below are
 * mounted under /api/v1/admin/* and require `platform_admin`; they declare both
 * bearerAuth and cookieAuth so the generated SDK client picks the right scheme.
 */
const listRoutesSpec = createRoute({
  method: 'get',
  path: '/routes',
  security: [],
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Paginated list of active routes',
      content: { 'application/json': { schema: envelope(z.array(RouteSchema)) } },
    },
  },
});
catalogRoutes.openapi(listRoutesSpec, async (c) => {
  const { limit, cursor } = c.req.valid('query');
  const { rows, cursor: nextCursor } = await catalogService.listRoutes(limit, cursor);
  return c.json({ data: rows, meta: { cursor: nextCursor, limit } }, 200);
});

const getRouteSpec = createRoute({
  method: 'get',
  path: '/routes/{id}',
  security: [],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Route', content: { 'application/json': { schema: envelope(RouteSchema) } } },
    404: { description: 'Route not found' },
  },
});
catalogRoutes.openapi(getRouteSpec, async (c) => {
  const { id } = c.req.valid('param');
  return c.json({ data: await catalogService.getRoute(id) }, 200);
});

const listPlansSpec = createRoute({
  method: 'get',
  path: '/plans',
  security: [],
  responses: {
    200: { description: 'All active subscription plans', content: { 'application/json': { schema: envelope(z.array(PlanSchema)) } } },
  },
});
catalogRoutes.openapi(listPlansSpec, async (c) => c.json({ data: await catalogService.listPlans() }, 200));

// ---------- Admin routes (mounted at /api/v1/admin/*) ----------
/**
 * Admin catalog routes. Every route declares both bearerAuth and cookieAuth so the
 * generated OpenAPI spec correctly advertises the auth requirement — without this,
 * the SDK consumer would see these as unauthenticated and the Semgrep/ZAP security
 * scans would flag them as auth-missing.
 *
 * `requireRole('platform_admin')` is applied at the router level via .use('*').
 */
export const adminCatalogRoutes = new TypedOpenAPIHono();
adminCatalogRoutes.use('*', requireRole('platform_admin'));

/** Security schemes for admin routes — mutable array, not `as const`, so it satisfies
 *  the SecurityRequirementObject[] type expected by @hono/zod-openapi. */
const adminSecurity: Array<{ bearerAuth: [] } | { cookieAuth: [] }> = [{ bearerAuth: [] }, { cookieAuth: [] }];

const adminListRoutesSpec = createRoute({
  method: 'get', path: '/routes', security: adminSecurity,
  request: { query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(100), cursor: z.string().optional() }) },
  responses: { 200: { description: 'All routes (admin view)', content: { 'application/json': { schema: envelope(z.array(RouteSchema)) } } } },
});
adminCatalogRoutes.openapi(adminListRoutesSpec, async (c) => {
  const { limit, cursor } = c.req.valid('query');
  const { rows, cursor: nextCursor } = await catalogService.listRoutes(limit, cursor);
  return c.json({ data: rows, meta: { cursor: nextCursor, limit } }, 200);
});

const adminCreateRouteSpec = createRoute({
  method: 'post', path: '/routes', security: adminSecurity,
  request: { body: { content: { 'application/json': { schema: CreateRouteInput } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: envelope(RouteSchema) } } },
    409: { description: 'Route name already exists' },
  },
});
adminCatalogRoutes.openapi(adminCreateRouteSpec, async (c) => {
  const body = c.req.valid('json');
  return c.json({ data: await catalogService.createRoute(body) }, 201);
});

const adminUpdateRouteSpec = createRoute({
  method: 'patch', path: '/routes/{id}', security: adminSecurity,
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: UpdateRouteInput } } } },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: envelope(RouteSchema) } } },
    404: { description: 'Route not found' },
  },
});
adminCatalogRoutes.openapi(adminUpdateRouteSpec, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  return c.json({ data: await catalogService.updateRoute(id, body) }, 200);
});

const adminDeleteRouteSpec = createRoute({
  method: 'delete', path: '/routes/{id}', security: adminSecurity,
  request: { params: z.object({ id: z.string() }) },
  responses: { 204: { description: 'Soft-deleted' }, 404: { description: 'Route not found' } },
});
adminCatalogRoutes.openapi(adminDeleteRouteSpec, async (c) => {
  const { id } = c.req.valid('param');
  await catalogService.deleteRoute(id);
  return c.body(null, 204);
});

// Shuttles
const ShuttleSchema = z.object({
  id: z.string(), plateNumber: z.string(), model: z.string(),
  year: z.number(), vehicleType: z.string(), capacity: z.number(), isActive: z.boolean(),
}).passthrough();

const adminListShuttlesSpec = createRoute({
  method: 'get', path: '/shuttles', security: adminSecurity,
  request: { query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(100), cursor: z.string().optional() }) },
  responses: { 200: { description: 'All shuttles', content: { 'application/json': { schema: envelope(z.array(ShuttleSchema)) } } } },
});
adminCatalogRoutes.openapi(adminListShuttlesSpec, async (c) => {
  const { limit, cursor } = c.req.valid('query');
  const { rows, cursor: nextCursor } = await catalogService.listShuttles(limit, cursor);
  return c.json({ data: rows, meta: { cursor: nextCursor, limit } }, 200);
});

const adminCreateShuttleSpec = createRoute({
  method: 'post', path: '/shuttles', security: adminSecurity,
  request: { body: { content: { 'application/json': { schema: CreateShuttleInput } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: envelope(ShuttleSchema) } } }, 409: { description: 'Plate number already registered' } },
});
adminCatalogRoutes.openapi(adminCreateShuttleSpec, async (c) => {
  const body = c.req.valid('json');
  return c.json({ data: await catalogService.createShuttle(body) }, 201);
});

const adminUpdateShuttleSpec = createRoute({
  method: 'patch', path: '/shuttles/{id}', security: adminSecurity,
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: UpdateShuttleInput } } } },
  responses: { 200: { description: 'Updated', content: { 'application/json': { schema: envelope(ShuttleSchema) } } }, 404: { description: 'Shuttle not found' } },
});
adminCatalogRoutes.openapi(adminUpdateShuttleSpec, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  return c.json({ data: await catalogService.updateShuttle(id, body) }, 200);
});

const adminDeleteShuttleSpec = createRoute({
  method: 'delete', path: '/shuttles/{id}', security: adminSecurity,
  request: { params: z.object({ id: z.string() }) },
  responses: { 204: { description: 'Deactivated' }, 404: { description: 'Shuttle not found' } },
});
adminCatalogRoutes.openapi(adminDeleteShuttleSpec, async (c) => {
  const { id } = c.req.valid('param');
  await catalogService.deleteShuttle(id);
  return c.body(null, 204);
});

// Plans — admin-only write operations. Public GET /plans is on catalogRoutes above.
// Previously missing: the admin UI's "Activate/Deactivate" toggle called PATCH /api/v1/admin/plans/:id,
// which 404'd because adminCatalogRoutes had no plan routes at all.
const adminCreatePlanSpec = createRoute({
  method: 'post', path: '/plans', security: adminSecurity,
  request: { body: { content: { 'application/json': { schema: CreatePlanInput } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: envelope(PlanSchema) } } }, 409: { description: 'Plan name already exists' } },
});
adminCatalogRoutes.openapi(adminCreatePlanSpec, async (c) => {
  const body = c.req.valid('json');
  return c.json({ data: await catalogService.createPlan(body) }, 201);
});

const adminUpdatePlanSpec = createRoute({
  method: 'patch', path: '/plans/{id}', security: adminSecurity,
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: UpdatePlanInput } } } },
  responses: { 200: { description: 'Updated', content: { 'application/json': { schema: envelope(PlanSchema) } } }, 404: { description: 'Plan not found' } },
});
adminCatalogRoutes.openapi(adminUpdatePlanSpec, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  return c.json({ data: await catalogService.updatePlan(id, body) }, 200);
});

const adminDeletePlanSpec = createRoute({
  method: 'delete', path: '/plans/{id}', security: adminSecurity,
  request: { params: z.object({ id: z.string() }) },
  responses: { 204: { description: 'Deactivated' }, 404: { description: 'Plan not found' } },
});
adminCatalogRoutes.openapi(adminDeletePlanSpec, async (c) => {
  const { id } = c.req.valid('param');
  await catalogService.deletePlan(id);
  return c.body(null, 204);
});
