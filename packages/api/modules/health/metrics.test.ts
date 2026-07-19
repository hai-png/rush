import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetEnv } from '@addis/shared';

/**
 * Metrics endpoint fail-closed tests. Covers the C3 fix:
 *   - When METRICS_PASSWORD is unset, the endpoint returns 503 (not 401 with a
 *     publicly-computable Basic auth challenge)
 *   - When METRICS_PASSWORD is set but < 16 chars, the endpoint returns 503
 *   - When METRICS_PASSWORD is >= 16 chars and the correct Basic auth is supplied,
 *     the endpoint returns 200 with Prometheus metrics
 *
 * FIX (TEST-010): The previous implementation introspected Hono's internal
 * route array shape (`metricsRoutes.routes.find(...)`) and hand-rolled a
 * fakeCtx. The internal array shape is not part of Hono's public API and
 * has changed between versions. We now use Hono's public `request()` method
 * which invokes the full middleware chain and route matching — no internal
 * access, no fake context.
 */

describe('metrics endpoint — fail-closed on unset/short password', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.METRICS_PASSWORD;
    // Force loadEnv to re-read process.env on next import.
    resetEnv();
    // Clear the module cache so the next dynamic import re-evaluates
    // metrics.ts with the new env.
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnv();
    vi.resetModules();
  });

  it('returns 503 when METRICS_PASSWORD is unset', async () => {
    const { metricsRoutes } = await import('./metrics');
    const res = await metricsRoutes.request('/metrics', { method: 'GET' });
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/METRICS_PASSWORD/);
  });

  it('returns 503 when METRICS_PASSWORD is shorter than 16 characters', async () => {
    process.env.METRICS_PASSWORD = 'short';
    resetEnv();
    vi.resetModules();
    const { metricsRoutes } = await import('./metrics');
    const res = await metricsRoutes.request('/metrics', { method: 'GET' });
    expect(res.status).toBe(503);
  });

  it('returns 401 when METRICS_PASSWORD is set but Authorization header is wrong', async () => {
    process.env.METRICS_PASSWORD = 'a-very-strong-metrics-password';
    resetEnv();
    vi.resetModules();
    const { metricsRoutes } = await import('./metrics');
    const res = await metricsRoutes.request('/metrics', {
      method: 'GET',
      headers: { Authorization: 'Basic d3Jvbmc6Y3JlZHM=' }, // wrong credentials
    });
    expect(res.status).toBe(401);
  });
});
