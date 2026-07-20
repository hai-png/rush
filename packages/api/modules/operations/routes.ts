import { TypedOpenAPIHono } from '../../src/typed-hono';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { requireRole } from '../../src/middleware/auth';
import { operationsService } from './service';
import { db, schema } from '@addis/db';
import { riderProfileIdFor, contractorProfileIdFor } from '../../src/profile-cache';
import { redis } from '../../infra/redis';

export const operationsRoutes = new TypedOpenAPIHono();

operationsRoutes.get('/trips', requireRole('contractor'), async (c) => {
  const profileId = await contractorProfileIdFor(c.get('session')!.userId);
  // API-004: paginate /trips — was returning ALL trips ever for the contractor.
  // Default to 50, max 200. Cursor pagination would be better but the table
  // lacks a monotonic cursor; limit + offset is acceptable for this admin-
  // ish endpoint. Status filter added.
  const limit = Math.min(Math.max(1, Number(c.req.query('limit') ?? 50) || 50), 200);
  const status = c.req.query('status');
  const VALID_STATUSES = ['scheduled', 'in_transit', 'completed', 'cancelled'] as const;
  const statusFilter = status && (VALID_STATUSES as readonly string[]).includes(status)
    ? (status as typeof VALID_STATUSES[number]) : undefined;
  const rows = await db.select().from(schema.trips)
    .where(and(
      eq(schema.trips.contractorId, profileId),
      statusFilter ? eq(schema.trips.status, statusFilter) : undefined,
    ))
    .orderBy(schema.trips.departTime)
    .limit(limit);
  return c.json({ data: rows });
});
operationsRoutes.post('/trips', requireRole('contractor'), async (c) => {
  const profileId = await contractorProfileIdFor(c.get('session')!.userId);

  const body = z.object({
    shuttleId: z.string(),
    routeId: z.string(),
    window: z.enum(['morning', 'evening']),

    departTime: z.never().optional(),
  }).parse(await c.req.json());
  const trip = await operationsService.startTrip(profileId, {
    shuttleId: body.shuttleId,
    routeId: body.routeId,
    window: body.window,
    departTime: new Date(),
  });
  return c.json({ data: trip }, 201);
});
operationsRoutes.patch('/trips/:id', requireRole('contractor'), async (c) => {
  const profileId = await contractorProfileIdFor(c.get('session')!.userId);
  const { event } = z.object({ event: z.literal('complete') }).parse(await c.req.json());
  const trip = event === 'complete' ? await operationsService.completeTrip(profileId, c.req.param('id')) : null;
  return c.json({ data: trip });
});

operationsRoutes.get('/rides', requireRole('rider'), async (c) => {
  const profileId = await riderProfileIdFor(c.get('session')!.userId);
  // API-004: paginate /rides — was returning ALL rides ever for the rider.
  const limit = Math.min(Math.max(1, Number(c.req.query('limit') ?? 50) || 50), 200);
  const status = c.req.query('status');
  const VALID_STATUSES = ['booked', 'boarded', 'completed', 'no_show', 'cancelled'] as const;
  const statusFilter = status && (VALID_STATUSES as readonly string[]).includes(status)
    ? (status as typeof VALID_STATUSES[number]) : undefined;
  const rows = await db.select().from(schema.rides)
    .where(and(
      eq(schema.rides.riderId, profileId),
      statusFilter ? eq(schema.rides.status, statusFilter) : undefined,
    ))
    .orderBy(schema.rides.createdAt)
    .limit(limit);
  return c.json({ data: rows });
});
operationsRoutes.post('/rides', requireRole('rider'), async (c) => {
  const profileId = await riderProfileIdFor(c.get('session')!.userId);
  const body = z.object({ tripId: z.string(), subscriptionId: z.string().optional(), seatClaimId: z.string().optional(), pickupStop: z.string().optional() }).parse(await c.req.json());
  const ride = await operationsService.bookRide(profileId, body);
  return c.json({ data: ride }, 201);
});
operationsRoutes.patch('/rides/:id', requireRole('rider'), async (c) => {
  const profileId = await riderProfileIdFor(c.get('session')!.userId);
  const { event } = z.object({ event: z.literal('board') }).parse(await c.req.json());
  const ride = event === 'board' ? await operationsService.board(profileId, c.req.param('id')) : null;
  return c.json({ data: ride });
});

operationsRoutes.get('/shuttle-positions', async (c) => {
  const ids = (c.req.query('shuttleIds') ?? '').split(',').filter(Boolean);
  if (!ids.length) {
    const rows = await db.select().from(schema.shuttlePositions);
    return c.json({ data: rows }, 200, { 'Cache-Control': 'public, max-age=10' });
  }
  const cached = await Promise.all(ids.map((id) => redis.hgetall(`shuttle:pos:${id}`)));
  return c.json({ data: cached.filter(Boolean) }, 200, { 'Cache-Control': 'public, max-age=10' });
});

operationsRoutes.post('/shuttle-positions', requireRole('contractor'), async (c) => {
  const body = z.object({ shuttleId: z.string(), lat: z.number(), lng: z.number(), heading: z.number().optional(), speed: z.number().optional() }).parse(await c.req.json());

  const profileId = await contractorProfileIdFor(c.get('session')!.userId);
  const [shuttle] = await db.select().from(schema.shuttles).where(eq(schema.shuttles.id, body.shuttleId));

  if (!shuttle || shuttle.contractorId !== profileId) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Not assigned to this shuttle', requestId: c.get('requestId') } }, 403);
  }

  const rlKey = `rl:gps:${body.shuttleId}`;
  const blocked = await redis.set(rlKey, '1', { nx: true, ex: 5 });
  if (!blocked) return c.json({ error: { code: 'RATE_LIMITED', message: 'GPS reports limited to 1 per 5s', requestId: c.get('requestId') } }, 429);

  const row = await operationsService.reportPosition(body.shuttleId, body);
  await redis.hset(`shuttle:pos:${body.shuttleId}`, { lat: row.lat, lng: row.lng, heading: row.heading, updatedAt: row.updatedAt });
  await redis.expire(`shuttle:pos:${body.shuttleId}`, 300);
  await redis.publish(`shuttle:updates:${body.shuttleId}`, JSON.stringify(row));
  return c.json({ data: row }, 201);
});

operationsRoutes.get('/shuttle-positions/stream', requireRole('rider'), async (c) => {
  const ids = (c.req.query('shuttleIds') ?? '').split(',').filter(Boolean);

  return new Response(new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const closed = { value: false };

      const pushPositions = async () => {
        if (closed.value) return;
        try {
          const positions = await Promise.all(ids.map((id) => redis.hgetall(`shuttle:pos:${id}`)));
          const valid = positions.filter(Boolean);
          if (valid.length) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(valid)}\n\n`));
          } else {
            controller.enqueue(encoder.encode(':heartbeat\n\n'));
          }
        } catch {

          controller.enqueue(encoder.encode(':heartbeat\n\n'));
        }
      };

      await pushPositions();
      const interval = setInterval(pushPositions, 5000);

      c.req.raw.signal.addEventListener('abort', () => {
        closed.value = true;
        clearInterval(interval);
        try { controller.close(); } catch {  }
      });
    },
  }), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } });
});
