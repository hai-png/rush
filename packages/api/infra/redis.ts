import { Redis } from '@upstash/redis';
import { loadEnv } from '@addis/shared';

const env = loadEnv();

type Entry = { value: string; expiresAt?: number };

function makeEntry(value: string, expiresAt?: number): Entry {
  // Helper so we can build an Entry without tripping `exactOptionalPropertyTypes: true`
  // (which forbids `expiresAt: undefined` on an optional property). Only attach the key
  // when we actually have a value to attach.
  return expiresAt !== undefined ? { value, expiresAt } : { value };
}

export const redis = env.REDIS_URL
  ? new Redis({ url: env.REDIS_URL, token: process.env.REDIS_TOKEN ?? '' })
  : new (class InMemoryFallback {
      // Dev/test fallback so local `bun dev` works without a Redis instance — dual-path per §7 rate-limit note.
      private store = new Map<string, Entry>();
      private sweep() {
        const now = Date.now();
        for (const [k, v] of this.store) if (v.expiresAt !== undefined && v.expiresAt <= now) this.store.delete(k);
      }
      async set(k: string, v: string, opts?: { nx?: boolean; ex?: number }) {
        this.sweep();
        if (opts?.nx && this.store.has(k)) return null;
        const expiresAt = opts?.ex !== undefined ? Date.now() + opts.ex * 1000 : undefined;
        this.store.set(k, makeEntry(v, expiresAt));
        return 'OK';
      }
      /**
       * Counter increment. Preserves the existing TTL — without this, the first INCR on a
       * rate-limit key (which is created without an EXPIRE in the rate-limit middleware's
       * "if count === 1 then EXPIRE" pattern, but a previous INCR-only call would have left
       * a no-TTL entry) would result in a counter that never expires, locking out the first
       * user to hit the limit forever. Real Redis preserves TTL across INCR.
       */
      async incr(k: string) {
        this.sweep();
        const existing = this.store.get(k);
        const cur = Number(existing?.value ?? 0) + 1;
        this.store.set(k, makeEntry(String(cur), existing?.expiresAt));
        return cur;
      }
      async expire(k: string, sec: number) { const e = this.store.get(k); if (e) e.expiresAt = Date.now() + sec * 1000; }
      async ttl(k: string) {
        this.sweep();
        const e = this.store.get(k);
        if (!e) return -2; // real Redis returns -2 for keys that don't exist
        return e.expiresAt ? Math.max(0, Math.round((e.expiresAt - Date.now()) / 1000)) : -1; // -1 = no expiry
      }
      async hset(k: string, v: Record<string, unknown>) {
        const existing = this.store.get(k);
        this.store.set(k, makeEntry(JSON.stringify(v), existing?.expiresAt));
      }
      async hgetall(k: string) {
        this.sweep();
        const e = this.store.get(k);
        return e ? JSON.parse(e.value) : null;
      }
      async publish() { /* no-op locally; SSE falls back to polling */ }
      duplicate() { return this; }
      async subscribe() { /* no-op */ }
      disconnect() {}
    })() as unknown as Redis;
