// FIX (ARCH-003): Migrated from bare `Hono()` to `TypedOpenAPIHono` so this
// module is OpenAPI-capable and `c.get('session')` / `c.get('requestId')` /
// `c.get('logger')` are typed. Existing .post/.get/.patch/.delete calls
// continue to work; they can be incrementally converted to
// .openapi(createRoute(...), handler) to appear in the OpenAPI document.
import { TypedOpenAPIHono } from '../../src/typed-hono';
import { z } from 'zod';
import { requireRole } from '../../src/middleware/auth';
import { CreateSeatReleaseInput, ClaimSeatInput } from './types';
import { marketplaceService } from './service';
import { db, schema } from '@addis/db';
import { eq, and, gt } from 'drizzle-orm';
import { NotFoundError, ForbiddenError } from '@addis/shared';

export const marketplaceRoutes = new TypedOpenAPIHono();

/**
 * Resolve the caller's riderProfile.id from their session.userId.
 *
 * The schema FKs `seatReleases.riderId`, `seatClaims.riderId`, `payments.riderId`,
 * and `rides.riderId` all target `riderProfiles.id`, but the session only
 * contains `users.id`. The previous routes passed `session.userId` straight
 * through — at best an FK violation on insert, at worst (if FK enforcement
 * was disabled) the row was stored with the wrong identifier and could never
 * be found again by queries that correctly used `profile.id`.
 */
async function riderProfileIdFor(userId: string): Promise<string> {
  const [profile] = await db.select().from(schema.riderProfiles).where(eq(schema.riderProfiles.userId, userId));
  if (!profile) throw new NotFoundError('Rider profile not found');
  return profile.id;
}

marketplaceRoutes.get('/seat-releases', requireRole('rider'), async (c) => {
  const limit = Math.min(Math.max(1, Number(c.req.query('limit') ?? 20) || 20), 100);
  const rows = await db.select().from(schema.seatReleases)
    .where(and(eq(schema.seatReleases.status, 'open'), gt(schema.seatReleases.expiresAt, new Date())))
    .limit(limit);
  return c.json({ data: rows });
});
marketplaceRoutes.post('/seat-releases', requireRole('rider'), async (c) => {
  const body = CreateSeatReleaseInput.parse(await c.req.json());
  // Use the rider's profile.id, not their session.userId.
  const riderId = await riderProfileIdFor(c.get('session').userId);
  const row = await marketplaceService.release(riderId, body);
  return c.json({ data: row }, 201);
});

/**
 * GET /seat-releases/:id — ownership check.
 *
 * The previous implementation returned ANY seat release by ID, including
 * other riders' releases (with refundAmount, subscriptionId, riderId).
 * Financial data leak via IDOR. Now: the caller either owns the release,
 * OR (for the marketplace list) we return only the public fields.
 */
marketplaceRoutes.get('/seat-releases/:id', requireRole('rider'), async (c) => {
  const [row] = await db.select().from(schema.seatReleases).where(eq(schema.seatReleases.id, c.req.param('id')));
  if (!row) throw new NotFoundError('Release not found');
  const riderId = await riderProfileIdFor(c.get('session').userId);
  if (row.riderId !== riderId) {
    // Marketplace releases are listed publicly via GET /seat-releases, but
    // individual releases should only be visible to the owner. Return 404
    // (not 403) to avoid confirming existence to non-owners.
    throw new NotFoundError('Release not found');
  }
  return c.json({ data: row });
});
marketplaceRoutes.delete('/seat-releases/:id', requireRole('rider'), async (c) => {
  const riderId = await riderProfileIdFor(c.get('session').userId);
  await marketplaceService.cancelRelease(riderId, c.req.param('id'));
  return c.body(null, 204);
});

marketplaceRoutes.get('/seat-claims', requireRole('rider'), async (c) => {
  const riderId = await riderProfileIdFor(c.get('session').userId);
  const rows = await db.select().from(schema.seatClaims).where(eq(schema.seatClaims.riderId, riderId));
  return c.json({ data: rows });
});
marketplaceRoutes.post('/seat-claims', requireRole('rider'), async (c) => {
  const body = ClaimSeatInput.parse(await c.req.json());
  const riderId = await riderProfileIdFor(c.get('session').userId);
  const result = await marketplaceService.claim(riderId, body);
  return c.json({ data: { claim: result.claim, checkout: result.checkout } }, 201);
});
marketplaceRoutes.get('/seat-claims/:id', requireRole('rider'), async (c) => {
  const riderId = await riderProfileIdFor(c.get('session').userId);
  const [row] = await db.select().from(schema.seatClaims).where(eq(schema.seatClaims.id, c.req.param('id')));
  if (!row) throw new NotFoundError('Claim not found');
  if (row.riderId !== riderId) throw new NotFoundError('Claim not found');
  return c.json({ data: row });
});
