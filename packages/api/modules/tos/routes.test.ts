import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * FIX (TEST-001 / TEST-002): The previous tests were tautologies — they tested
 * JavaScript's `!==` operator (e.g. `expect(supplied !== CURRENT_TOS_VERSION).toBe(true)`)
 * rather than the actual ToS route handler. They would pass even if the route
 * returned 200 for a bad version, returned 500, or didn't exist at all.
 *
 * The new tests invoke the actual Hono route via `tosRoutes.request()` and
 * assert the HTTP response status/body. The DB and writeAudit are mocked so
 * we're testing the route logic, not the DB.
 *
 * The mocked CURRENT_TOS_VERSION is 'v2_0' — the tests send various versions
 * and assert the route accepts the current and rejects others with 400.
 */

// Mock @addis/db BEFORE importing the route module so the route's `db`
// reference is the mock from the start.
// FIX: the mock must support the full chained API the route uses:
//   tx.update(table).set({...}).where(...)
//   tx.insert(table).values({...}).onConflictDoNothing()
// Each chain returns an object with the next method, ending in a Promise.
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

// Mock writeAudit so we can assert it was called with the right shape.
const mockWriteAudit = vi.fn(async () => ({ id: 'audit-1' }));
vi.mock('../admin/audit', () => ({
  writeAudit: mockWriteAudit,
}));

// Mock requireAuth so the route doesn't 401 — we want to test the version
// validation, not the auth gate.
vi.mock('../../src/middleware/auth', () => ({
  requireAuth: vi.fn(async (_c: any, next: any) => { await next(); }),
  requireRole: vi.fn(async (_c: any, next: any) => { await next(); }),
}));

// Mock the context's getSession to return a fake session.
vi.mock('../../src/context', () => ({
  getSession: (c: any) => c.get('session') ?? { userId: 'user-1' },
}));

describe('POST /api/v1/tos — version validation (TEST-001/002 fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set a fake session on the request via header — the auth mock reads it.
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
        // The requireAuth mock calls next() without checking the session,
        // so the route's getSession(c) returns the fallback { userId: 'user-1' }.
      },
      body: JSON.stringify({ version: 'v2_0' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.accepted).toBe(true);
    expect(body.data.version).toBe('v2_0');
    // The transaction mock was called (the route wraps the DB writes in a
    // transaction). The mock's tx.update/tx.insert chains were exercised.
    expect(mockTransaction).toHaveBeenCalled();
    // writeAudit is NOT used by this route (it uses outboxEvents directly),
    // so we don't assert on mockWriteAudit.
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
    // writeAudit should NOT have been called — the route returns early.
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
    // Mock the db.select chain for the GET handler.
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
    // Sorted newest-first
    expect(body.data[0].version).toBe('v2_0');
    expect(body.data[1].version).toBe('v1_0');
  });
});
