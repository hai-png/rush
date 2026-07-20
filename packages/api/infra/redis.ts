import { Redis } from '@upstash/redis';
import { loadEnv } from '@addis/shared';

const env = loadEnv();

if (!env.REDIS_URL && env.NODE_ENV === 'production') {
  throw new Error('REDIS_URL is required in production; refusing to start with in-memory fallback');
}

class InMemoryRedis {

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
    if (opts?.nx && existing) return null;
    this.store.set(k, { value: v, ...(opts?.ex ? { expiresAt: Date.now() + opts.ex * 1000 } : {}) });
    return 'OK';
  }
  async incr(k: string) {
    const e = this.cleanup(k);
    const cur = Number(e?.value ?? 0) + 1;

    this.store.set(k, { value: String(cur), ...(e?.expiresAt ? { expiresAt: e.expiresAt } : {}) });
    return cur;
  }
  // FE-006: add get() for the profile-ID cache. The Upstash Redis client
  // has get(); the in-memory shim was missing it.
  async get(k: string): Promise<string | null> {
    const e = this.cleanup(k);
    if (!e) return null;
    return e.value;
  }
  async expire(k: string, sec: number) {
    const e = this.cleanup(k);
    if (e) e.expiresAt = Date.now() + sec * 1000;
  }
  async ttl(k: string): Promise<number> {
    const e = this.cleanup(k);
    if (!e) return -2;
    if (!e.expiresAt) return -1;
    return Math.max(0, Math.round((e.expiresAt - Date.now()) / 1000));
  }
  async hset(k: string, v: Record<string, unknown>) {
    const existing = this.cleanup(k);

    let prev: Record<string, unknown> = {};
    if (existing) {
      try { prev = JSON.parse(existing.value); } catch { prev = {}; }
    }
    const merged = { ...prev, ...v };
    this.store.set(k, { value: JSON.stringify(merged), ...(existing?.expiresAt ? { expiresAt: existing.expiresAt } : {}) });
  }
  async hgetall(k: string) {
    const e = this.cleanup(k);
    if (!e) return null;

    try { return JSON.parse(e.value); } catch { return null; }
  }
  async del(k: string) { this.store.delete(k); return 1; }
  async publish() {  }
  duplicate() { return this; }
  async subscribe() {  }
  disconnect() {}
}

export const redis: Redis = env.REDIS_URL
  ? new Redis({ url: env.REDIS_URL, token: process.env.REDIS_TOKEN ?? '' })
  : (new InMemoryRedis() as unknown as Redis);
