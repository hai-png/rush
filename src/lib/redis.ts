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

export function isRedisAvailable(): boolean {
  return redisClient !== null;
}

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

const LOCK_SCRIPT = `
  if redis.call("SET", KEYS[1], ARGV[1], "NX", "EX", ARGV[2]) then
    return 1
  end
  return 0
`;

const UNLOCK_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`;

export async function redisLock(key: string, ttlSec = 30, retryMs = 200, maxRetries = 15): Promise<{ release: () => Promise<void> } | null> {
  const redis = await getRedis();
  if (!redis) return null;

  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const ok = await redis.eval(LOCK_SCRIPT, 1, `lock:${key}`, token, ttlSec);
    if (ok) {
      return {
        release: async () => {
          try { await redis.eval(UNLOCK_SCRIPT, 1, `lock:${key}`, token); } catch { /* ignore */ }
        },
      };
    }
    await new Promise(r => setTimeout(r, retryMs));
  }
  return null;
}

