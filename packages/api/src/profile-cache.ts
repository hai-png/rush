import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { redis } from '../infra/redis';

// FE-006: profile-ID resolution cache. Every contractor/rider route resolves
// the profile ID from the user ID via a DB query — for a contractor reporting
// GPS every 10 seconds, that's 6 extra queries per minute per contractor.
// Cache the mapping in Redis for 5 minutes. Writes are rare (only on signup
// and role-change), so the cache can be invalidated lazily — a stale entry
// just means one extra DB query on the next miss after the profile is
// deleted, which falls through to the NotFoundError.

const TTL_SEC = 300;
const riderKey = (userId: string) => `profile:rider:${userId}`;
const contractorKey = (userId: string) => `profile:contractor:${userId}`;

export async function riderProfileIdFor(userId: string): Promise<string> {
  const key = riderKey(userId);
  const cached = await redis.get(key).catch(() => null);
  if (cached && typeof cached === 'string') return cached;
  const [profile] = await db.select({ id: schema.riderProfiles.id })
    .from(schema.riderProfiles).where(eq(schema.riderProfiles.userId, userId));
  if (!profile) throw new (await import('@addis/shared')).NotFoundError('Rider profile not found');
  await redis.set(key, profile.id, { ex: TTL_SEC }).catch(() => {});
  return profile.id;
}

export async function contractorProfileIdFor(userId: string): Promise<string> {
  const key = contractorKey(userId);
  const cached = await redis.get(key).catch(() => null);
  if (cached && typeof cached === 'string') return cached;
  const [profile] = await db.select({ id: schema.contractorProfiles.id })
    .from(schema.contractorProfiles).where(eq(schema.contractorProfiles.userId, userId));
  if (!profile) throw new (await import('@addis/shared')).NotFoundError('Contractor profile not found');
  await redis.set(key, profile.id, { ex: TTL_SEC }).catch(() => {});
  return profile.id;
}

// Invalidate on profile deletion / role change. Called from admin suspend,
// role change, and account deletion flows.
export async function invalidateProfileIdCache(opts: { userId?: string; rider?: boolean; contractor?: boolean }): Promise<void> {
  if (!opts.userId) return;
  const keys: string[] = [];
  if (opts.rider !== false) keys.push(riderKey(opts.userId));
  if (opts.contractor !== false) keys.push(contractorKey(opts.userId));
  await Promise.all(keys.map(k => redis.del(k).catch(() => {})));
}
