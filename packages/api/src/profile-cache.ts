import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { redis } from '../infra/redis';
import { NotFoundError } from '@addis/shared';

const TTL_SEC = 300;
const riderKey = (userId: string) => `profile:rider:${userId}`;
const contractorKey = (userId: string) => `profile:contractor:${userId}`;

export async function riderProfileIdFor(userId: string): Promise<string> {
  const key = riderKey(userId);
  const cached = await redis.get(key).catch(() => null);
  if (cached && typeof cached === 'string') return cached;
  const [profile] = await db.select({ id: schema.riderProfiles.id })
    .from(schema.riderProfiles).where(eq(schema.riderProfiles.userId, userId));
  if (!profile) throw new NotFoundError('Rider profile not found');
  await redis.set(key, profile.id, { ex: TTL_SEC }).catch(() => {});
  return profile.id;
}

export async function contractorProfileIdFor(userId: string): Promise<string> {
  const key = contractorKey(userId);
  const cached = await redis.get(key).catch(() => null);
  if (cached && typeof cached === 'string') return cached;
  const [profile] = await db.select({ id: schema.contractorProfiles.id })
    .from(schema.contractorProfiles).where(eq(schema.contractorProfiles.userId, userId));
  if (!profile) throw new NotFoundError('Contractor profile not found');
  await redis.set(key, profile.id, { ex: TTL_SEC }).catch(() => {});
  return profile.id;
}

export async function invalidateProfileIdCache(opts: { userId?: string; rider?: boolean; contractor?: boolean }): Promise<void> {
  if (!opts.userId) return;
  const keys: string[] = [];
  if (opts.rider !== false) keys.push(riderKey(opts.userId));
  if (opts.contractor !== false) keys.push(contractorKey(opts.userId));
  await Promise.all(keys.map(k => redis.del(k).catch(() => {})));
}
