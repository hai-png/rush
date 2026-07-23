// Redis-backed cache with in-memory fallback.
//
// If REDIS_URL is set, uses Redis for distributed rate limiting + shuttle
// positions (shared across instances). If not set, falls back to in-memory
// Maps (single-instance only — documented limitation).
//
// The fallback ensures the app works in dev and small-scale prod without
// requiring Redis. When the user scales to multiple instances, they just
// set REDIS_URL and everything switches automatically.

import { loadEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

let redisClient: any = null;
let redisChecked = false;

export async function getRedis(): Promise<any | null> {
  if (redisChecked) return redisClient;
  redisChecked = true;

  const env = loadEnv();
  if (!env.REDIS_URL) return null;

  try {
    // Dynamic import so the app doesn't crash if ioredis isn't installed.
    const Ioredis = (await import('ioredis')).default;
    redisClient = new Ioredis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    redisClient.on('error', (err: Error) => {
      logger.error({ err: err.message }, '[redis] connection error');
    });
    redisClient.on('connect', () => {
      logger.info('[redis] connected');
    });
    await redisClient.ping();
    logger.info('[redis] ping OK — using Redis for shared state');
    return redisClient;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, '[redis] failed to connect, falling back to in-memory');
    redisClient = null;
    return null;
  }
}

// Check if Redis is available (non-blocking — returns cached value).
export function isRedisAvailable(): boolean {
  return redisClient !== null;
}

// Sliding-window rate limiter using Redis INCR + EXPIRE.
// Returns { count, expiresAt } or null if Redis isn't available.
export async function redisRateLimit(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; count: number; retryAfter: number } | null> {
  const redis = await getRedis();
  if (!redis) return null;

  const now = Date.now();
  const bucketKey = `rl:${key}`;
  const count = await redis.incr(bucketKey);
  if (count === 1) {
    await redis.expire(bucketKey, windowSec);
  }
  if (count > limit) {
    const ttl = await redis.ttl(bucketKey);
    return { allowed: false, count, retryAfter: ttl > 0 ? ttl : windowSec };
  }
  return { allowed: true, count, retryAfter: 0 };
}

// Shuttle position storage with TTL.
export async function redisSetPosition(key: string, value: any, ttlSec: number): Promise<void> {
  const redis = await getRedis();
  if (!redis) throw new Error('Redis not available');
  await redis.set(`pos:${key}`, JSON.stringify({ ...value, updatedAt: Date.now() }), 'EX', ttlSec);
}

export async function redisGetPosition(key: string): Promise<any | null> {
  const redis = await getRedis();
  if (!redis) throw new Error('Redis not available');
  const raw = await redis.get(`pos:${key}`);
  return raw ? JSON.parse(raw) : null;
}

export async function redisGetAllPositions(pattern: string): Promise<any[]> {
  const redis = await getRedis();
  if (!redis) throw new Error('Redis not available');
  const keys = await redis.keys(pattern);
  if (keys.length === 0) return [];
  const values = await redis.mget(...keys);
  return values.filter(Boolean).map((v: string) => JSON.parse(v));
}
