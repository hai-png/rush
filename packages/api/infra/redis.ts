import { Redis } from '@upstash/redis';
import { loadEnv } from '@addis/shared';

const env = loadEnv();

// Production guard: in-memory Redis fallback was silently degrading every
// multi-instance guarantee (rate limits, OTP send locks, cron advisory locks,
// idempotency dedup, GPS cache). The env schema now requires REDIS_URL in
// production, but double-assert here so a misconfigured staging or a future
// env-loosening change can't silently fall back.
if (!env.REDIS_URL && env.NODE_ENV === 'production') {
  throw new Error('REDIS_URL is required in production; refusing to start with in-memory fallback');
}

class InMemoryRedis {
  // Dev/test fallback so local `bun dev` works without a Redis instance.
  // NOT suitable for production — every per-IP/per-account counter is
  // per-process, so two API instances allow 2x the rate limit, etc.
  private store = new Map<string, { value: string; expiresAt?: number }>();

  private isExpired(entry: { expiresAt?: number } | undefined): boolean {
    return !!entry?.expiresAt && entry.expiresAt <= Date.now();
  }

  private cleanup(k: string) {
    const e = this.store.get(k);
    if (this.isExpired(e)) { this.store.delete(k); return undefined; }
    return e;
  }

  async set(k: string, v: string, opts?: { nx?: boolean; ex?: number }) {
    const existing = this.cleanup(k);
    if (opts?.nx && existing) return null; // NX requires key absent (or expired)
    this.store.set(k, { value: v, expiresAt: opts?.ex ? Date.now() + opts.ex * 1000 : undefined });
    return 'OK';
  }
  async incr(k: string) {
    const e = this.cleanup(k);
    const cur = Number(e?.value ?? 0) + 1;
    // Preserve the existing TTL on INCR — Redis semantics. The previous
    // implementation overwrote the entry with no expiresAt, leaking the
    // counter forever and breaking rate-limit windows.
    this.store.set(k, { value: String(cur), expiresAt: e?.expiresAt });
    return cur;
  }
  async expire(k: string, sec: number) {
    const e = this.cleanup(k);
    if (e) e.expiresAt = Date.now() + sec * 1000;
  }
  async ttl(k: string): Promise<number> {
    const e = this.cleanup(k);
    if (!e) return -2; // key does not exist (matches Redis semantics)
    if (!e.expiresAt) return -1; // key exists but has no TTL
    return Math.max(0, Math.round((e.expiresAt - Date.now()) / 1000));
  }
  async hset(k: string, v: Record<string, unknown>) {
    const existing = this.cleanup(k);
    // FIX: the previous implementation called JSON.parse(existing.value)
    // unconditionally — but if the key was previously set via `set(k, 'initial')`
    // (a plain string, not JSON), JSON.parse threw "Unexpected token 'i'".
    // Parse defensively: if the existing value isn't valid JSON, treat it
    // as an empty object (the hset replaces it with a JSON object anyway).
    let prev: Record<string, unknown> = {};
    if (existing) {
      try { prev = JSON.parse(existing.value); } catch { prev = {}; }
    }
    const merged = { ...prev, ...v };
    this.store.set(k, { value: JSON.stringify(merged), expiresAt: existing?.expiresAt });
  }
  async hgetall(k: string) {
    const e = this.cleanup(k);
    if (!e) return null;
    // FIX: same defensive parse as hset — a key set via `set(k, 'string')`
    // would crash hgetall. Return null for non-JSON values (matches Redis
    // semantics where hgetall on a non-hash key returns an error).
    try { return JSON.parse(e.value); } catch { return null; }
  }
  async del(k: string) { this.store.delete(k); return 1; }
  async publish() { /* no-op locally; SSE falls back to polling */ }
  duplicate() { return this; }
  async subscribe() { /* no-op */ }
  disconnect() {}
}

export const redis: Redis = env.REDIS_URL
  ? new Redis({ url: env.REDIS_URL, token: process.env.REDIS_TOKEN ?? '' })
  : (new InMemoryRedis() as unknown as Redis);
