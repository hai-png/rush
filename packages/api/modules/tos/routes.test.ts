import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockTransaction = vi.fn(async (fn: any) => fn({
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(async () => [{ id: 'user-1' }]),
    })),
  })),
  insert: vi.fn(() => ({
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(async () => undefined),
    })),
  })),
  execute: vi.fn(async () => ({ rows: [{ locked: true }] })),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => []),
      orderBy: vi.fn(() => ({ limit: vi.fn(async () => []) })),
    })),
  })),
}));

vi.mock('@addis/db', () => ({
  db: { transaction: mockTransaction },
  schema: new Proxy({}, { get: () => ({}) }),
}));

vi.mock('@addis/shared', async () => {
  const actual = await vi.importActual('@addis/shared');
  return {
    ...actual,
    CURRENT_TOS_VERSION: 'v2_0',
  };
});

const mockWriteAudit = vi.fn(async () => ({ id: 'audit-1' }));
vi.mock('../admin/audit', () => ({
  writeAudit: mockWriteAudit,
}));

vi.mock('../../src/middleware/auth', () => ({
  requireAuth: vi.fn(async (_c: any, next: any) => { await next(); }),
  requireRole: vi.fn(async (_c: any, next: any) => { await next(); }),
}));

vi.mock('../../src/context', () => ({
  getSession: (c: any) => c.get('session') ?? { userId: 'user-1' },
}));

describe('POST /api/v1/tos — version validation (TEST-001/002 fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('accepts the current ToS version and returns 200', async () => {
    const { tosRoutes } = await import('./routes');
    const res = await tosRoutes.request('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',

      },
      body: JSON.stringify({ version: 'v2_0' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.accepted).toBe(true);
    expect(body.data.version).toBe('v2_0');

    expect(mockTransaction).toHaveBeenCalled();

  });

  it('rejects a version that does not match CURRENT_TOS_VERSION with 400', async () => {
    const { tosRoutes } = await import('./routes');
    const res = await tosRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 'v9_9' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toMatch(/Unsupported ToS version/i);

    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it('rejects an empty version string with 400', async () => {
    const { tosRoutes } = await import('./routes');
    const res = await tosRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a missing version field with 400 (Zod validation)', async () => {
    const { tosRoutes } = await import('./routes');
    const res = await tosRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/tos — acceptance history', () => {
  it('returns the caller\'s acceptance history', async () => {
    const { tosRoutes } = await import('./routes');

    const { db } = await import('@addis/db');
    (db as any).select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [
          { userId: 'user-1', version: 'v2_0', acceptedAt: new Date('2026-01-01') },
          { userId: 'user-1', version: 'v1_0', acceptedAt: new Date('2025-01-01') },
        ]),
      })),
    }));
    const res = await tosRoutes.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);

    expect(body.data[0].version).toBe('v2_0');
    expect(body.data[1].version).toBe('v1_0');
  });
});
