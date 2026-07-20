import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('In-memory Redis fallback', () => {
  let redis: any;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock('@addis/shared', () => ({
      loadEnv: () => ({
        REDIS_URL: undefined,
        NODE_ENV: 'test',
        LOG_LEVEL: 'error',
      }),
    }));
    ({ redis } = await import('./redis'));
  });

  it('incr() preserves TTL set by a prior set({ex}) call', async () => {
    await redis.set('rl:foo', '1', { ex: 600 });
    expect(await redis.ttl('rl:foo')).toBeGreaterThan(0);

    const before = await redis.ttl('rl:foo');
    await redis.incr('rl:foo');
    await redis.incr('rl:foo');
    await redis.incr('rl:foo');
    const after = await redis.ttl('rl:foo');

    expect(after).toBeGreaterThan(0);

    expect(Math.abs(before - after)).toBeLessThanOrEqual(2);
  });

  it('ttl() returns -2 for missing keys', async () => {
    expect(await redis.ttl('does-not-exist')).toBe(-2);
  });

  it('ttl() returns -1 for keys without an expiry', async () => {
    await redis.set('no-expiry', 'hello');
    expect(await redis.ttl('no-expiry')).toBe(-1);
  });

  it('set({nx:true}) refuses to overwrite an existing key', async () => {
    await redis.set('nx-key', 'first');
    const result = await redis.set('nx-key', 'second', { nx: true });
    expect(result).toBeNull();

    await redis.set('nx-key', 'first-confirmed');
    expect(await redis.ttl('nx-key')).toBe(-1);
  });

  it('hset preserves TTL from the original key', async () => {
    await redis.set('hash-key', 'initial', { ex: 300 });
    const ttlBefore = await redis.ttl('hash-key');
    expect(ttlBefore).toBeGreaterThan(0);

    await redis.hset('hash-key', { field1: 'value1' });
    const ttlAfter = await redis.ttl('hash-key');
    expect(ttlAfter).toBeGreaterThan(0);
    expect(Math.abs(ttlBefore - ttlAfter)).toBeLessThanOrEqual(2);

    const data = await redis.hgetall('hash-key');
    expect(data.field1).toBe('value1');
  });
});
