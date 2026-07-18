import { Hono } from 'hono';
import { z } from 'zod';
import { requireRole } from '../../src/middleware/auth';
import { operationsService } from './service';
import { db, schema } from '@addis/db';
import { eq, and } from 'drizzle-orm';
import { redis } from '../../infra/redis';

export const operationsRoutes = new Hono();

operationsRoutes.get('/trips', requireRole('contractor'), async (c) => {
  const [profile] = await db.select().from(schema.contractorProfiles).where(eq(schema.contractorProfiles.userId, c.get('session').userId));
  const rows = await db.select().from(schema.trips).where(eq(schema.trips.contractorId, profile!.id));
  return c.json({ data: rows });
});
operationsRoutes.post('/trips', requireRole('contractor'), async (c) => {
  const [profile] = await db.select().from(schema.contractorProfiles).where(eq(schema.contractorProfiles.userId, c.get('session').userId));
  const body = z.object({ shuttleId: z.string(), routeId: z.string(), window: z.enum(['morning', 'evening']), departTime: z.coerce.date() }).parse(await c.req.json());
  const trip = await operationsService.startTrip(profile!.id, body);
  return c.json({ data: trip }, 201);
});
operationsRoutes.patch('/trips/:id', requireRole('contractor'), async (c) => {
  const [profile] = await db.select().from(schema.contractorProfiles).where(eq(schema.contractorProfiles.userId, c.get('session').userId));
  const { event } = z.object({ event: z.literal('complete') }).parse(await c.req.json());
  const trip = event === 'complete' ? await operationsService.completeTrip(profile!.id, c.req.param('id')) : null;
  return c.json({ data: trip });
});

operationsRoutes.get('/rides', requireRole('rider'), async (c) => {
  const [profile] = await db.select().from(schema.riderProfiles).where(eq(schema.riderProfiles.userId, c.get('session').userId));
  const rows = await db.select().from(schema.rides).where(eq(schema.rides.riderId, profile!.id));
  return c.json({ data: rows });
});
operationsRoutes.post('/rides', requireRole('rider'), async (c) => {
  const [profile] = await db.select().from(schema.riderProfiles).where(eq(schema.riderProfiles.userId, c.get('session').userId));
  const body = z.object({ tripId: z.string(), subscriptionId: z.string().optional(), seatClaimId: z.string().optional(), pickupStop: z.string().optional() }).parse(await c.req.json());
  const ride = await operationsService.bookRide(profile!.id, body);
  return c.json({ data: ride }, 201);
});
operationsRoutes.patch('/rides/:id', requireRole('rider'), async (c) => {
  const [profile] = await db.select().from(schema.riderProfiles).where(eq(schema.riderProfiles.userId, c.get('session').userId));
  const { event } = z.object({ event: z.literal('board') }).parse(await c.req.json());
  const ride = event === 'board' ? await operationsService.board(profile!.id, c.req.param('id')) : null;
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
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(':heartbeat\n\n')), 15000);
      const sub = redis.duplicate();
      for (const id of ids) {
        await sub.subscribe(`shuttle:updates:${id}`, (message) => {
          controller.enqueue(encoder.encode(`data: ${message}\n\n`));
        });
      }
      c.req.raw.signal.addEventListener('abort', () => { clearInterval(heartbeat); sub.disconnect(); controller.close(); });
    },
  }), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } });
});
