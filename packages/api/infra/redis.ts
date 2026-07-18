import { Redis } from '@upstash/redis';
import { loadEnv } from '@addis/shared';

const env = loadEnv();
export const redis = env.REDIS_URL
  ? new Redis({ url: env.REDIS_URL, token: process.env.REDIS_TOKEN ?? '' })
  : new (class InMemoryFallback {
      // Dev/test fallback so local `bun dev` works without a Redis instance — dual-path per §7 rate-limit note.
      private store = new Map<string, { value: string; expiresAt?: number }>();
      async set(k: string, v: string, opts?: { nx?: boolean; ex?: number }) {
        if (opts?.nx && this.store.has(k)) return null;
        this.store.set(k, { value: v, expiresAt: opts?.ex ? Date.now() + opts.ex * 1000 : undefined });
        return 'OK';
      }
      async incr(k: string) { const cur = Number(this.store.get(k)?.value ?? 0) + 1; this.store.set(k, { value: String(cur) }); return cur; }
      async expire(k: string, sec: number) { const e = this.store.get(k); if (e) e.expiresAt = Date.now() + sec * 1000; }
      async ttl(k: string) { const e = this.store.get(k); return e?.expiresAt ? Math.max(0, Math.round((e.expiresAt - Date.now()) / 1000)) : -1; }
      async hset(k: string, v: Record<string, unknown>) { this.store.set(k, { value: JSON.stringify(v) }); }
      async hgetall(k: string) { const e = this.store.get(k); return e ? JSON.parse(e.value) : null; }
      async publish() { /* no-op locally; SSE falls back to polling */ }
      duplicate() { return this; }
      async subscribe() { /* no-op */ }
      disconnect() {}
    })() as unknown as Redis;
