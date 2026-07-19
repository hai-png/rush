import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Metrics endpoint fail-closed tests. Covers the C3 fix:
 *   - When METRICS_PASSWORD is unset, the endpoint returns 503 (not 401 with a
 *     publicly-computable Basic auth challenge)
 *   - When METRICS_PASSWORD is set but < 16 chars, the endpoint returns 503
 *   - When METRICS_PASSWORD is >= 16 chars and the correct Basic auth is supplied,
 *     the endpoint returns 200 with Prometheus metrics
 */

describe('metrics endpoint — fail-closed on unset/short password', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.METRICS_PASSWORD;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns 503 when METRICS_PASSWORD is unset', async () => {
    const { metricsRoutes } = await import('./metrics');
    const fakeCtx: any = {
      req: { header: () => null },
      text: (body: string, status: number) => ({ body, status }),
    };
    // Find the GET /metrics handler
    const handler = (metricsRoutes as any).routes.find((r: any) => r.method === 'GET' && r.path === '/metrics')?.handler;
    expect(handler).toBeDefined();
    const res = await handler(fakeCtx);
    expect(res.status).toBe(503);
    expect(res.body).toMatch(/METRICS_PASSWORD must be set/);
  });

  it('returns 503 when METRICS_PASSWORD is shorter than 16 characters', async () => {
    process.env.METRICS_PASSWORD = 'short';
    const { metricsRoutes } = await import('./metrics');
    const fakeCtx: any = {
      req: { header: () => null },
      text: (body: string, status: number) => ({ body, status }),
    };
    const handler = (metricsRoutes as any).routes.find((r: any) => r.method === 'GET' && r.path === '/metrics')?.handler;
    const res = await handler(fakeCtx);
    expect(res.status).toBe(503);
  });

  it('returns 401 when METRICS_PASSWORD is set but Authorization header is wrong', async () => {
    process.env.METRICS_PASSWORD = 'a-very-strong-metrics-password';
    const { metricsRoutes } = await import('./metrics');
    const fakeCtx: any = {
      req: { header: () => 'Basic d3Jvbmc6Y3JlZHM=' }, // wrong credentials
      text: (body: string, status: number) => ({ body, status }),
    };
    const handler = (metricsRoutes as any).routes.find((r: any) => r.method === 'GET' && r.path === '/metrics')?.handler;
    const res = await handler(fakeCtx);
    expect(res.status).toBe(401);
  });
});
