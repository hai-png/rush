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

  const [profile] = await db.select().from(schema.contractorProfiles).where(eq(schema.contractorProfiles.userId, c.get('session').userId));
  const [shuttle] = await db.select().from(schema.shuttles).where(eq(schema.shuttles.id, body.shuttleId));
  // Without this check, any authenticated contractor could POST a position update for ANY
  // shuttle — not just their own — spoofing another shuttle's live location shown to riders,
  // or faking their own without actually driving.
  if (!shuttle || shuttle.contractorId !== profile?.id) {
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
  /**
   * Server-Sent Events stream of live shuttle positions.
   *
   * The previous implementation called `redis.duplicate()` and `sub.subscribe()` —
   * ioredis-style APIs that do not exist on @upstash/redis (which is HTTP-based, not
   * connection-based). The code would have thrown at runtime the first time a rider
   * opened the live-trip screen.
   *
   * We now poll the cached positions from Redis every 5s and push them as SSE events.
   * This is less efficient than true pub/sub (5s of latency vs. instant) but works
   * with the existing @upstash/redis client. A future optimisation is to switch to
   * a Redis client that supports pub/sub (e.g. ioredis or node-redis) for this
   * endpoint only, keeping @upstash/redis for the rate-limit/OTP counters.
   */
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
          // Redis hiccup — don't kill the stream; next tick will retry.
          controller.enqueue(encoder.encode(':heartbeat\n\n'));
        }
      };

      // Initial push, then poll every 5s.
      await pushPositions();
      const interval = setInterval(pushPositions, 5000);

      c.req.raw.signal.addEventListener('abort', () => {
        closed.value = true;
        clearInterval(interval);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  }), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } });
});
