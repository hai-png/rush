import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetEnv } from '@addis/shared';

describe('metrics endpoint — fail-closed on unset/short password', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.METRICS_PASSWORD;

    resetEnv();

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
      headers: { Authorization: 'Basic d3Jvbmc6Y3JlZHM=' },
    });
    expect(res.status).toBe(401);
  });
});
