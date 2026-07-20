import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Ticket service tests. The SEC-002 fix added an IDOR ownership check inside
 * `supportService.setStatus` itself (not just in the route handler): when the
 * event is `user.reopened`, the caller's id must match the ticket's userId.
 * These tests verify:
 *   1. The happy-path transition still works when the caller IS the owner.
 *   2. A non-owner caller is rejected with "Not your ticket" (IDOR fix).
 *   3. Staff-driven transitions (staff.resolved) bypass the ownership check.
 *   4. NotFoundError is thrown when the ticket doesn't exist.
 */

const TICKET_ROW = {
  id: 'ticket-1', userId: 'user-owner-1', status: 'resolved',
  firstResponseAt: new Date(), resolvedAt: new Date(), assignedToId: null,
  subject: 'Test', body: 'Test body', priority: 'normal', category: 'general',
  closedAt: null,
};

vi.mock('@addis/db', () => {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(async () => [TICKET_ROW]),
  };
  const updateChain = {
    set: vi.fn(() => updateChain),
    where: vi.fn(async () => [TICKET_ROW]),
  };
  return {
    db: {
      select: vi.fn(() => chain),
      update: vi.fn(() => updateChain),
      insert: vi.fn(() => ({ values: vi.fn() })),
    },
    schema: new Proxy({}, { get: () => ({}) }),
  };
});

vi.mock('./state', () => ({
  ticketState: {
    resolve: vi.fn((current: string, event: string) => {
      if (current === 'resolved' && event === 'user.reopened') return { from: 'resolved', to: 'open', sideEffects: [] };
      if (current === 'closed' && event === 'user.reopened') return { from: 'closed', to: 'open', sideEffects: [] };
      if (current === 'open' && event === 'staff.resolved') return { from: 'open', to: 'resolved', sideEffects: ['notify.support_resolved'] };
      if (current === 'in_progress' && event === 'staff.resolved') return { from: 'in_progress', to: 'resolved', sideEffects: ['notify.support_resolved'] };
      throw new Error(`No transition from ${current} on ${event}`);
    }),
  },
}));

describe('supportService.setStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('transitions a resolved ticket to open on user.reopened (owner caller)', async () => {
    const { supportService } = await import('./service');
    // FIX (SEC-002): pass the ticket's actual owner as the caller so the
    // IDOR ownership check passes.
    const result = await supportService.setStatus('user-owner-1', 'ticket-1', 'user.reopened');
    expect(result.to).toBe('open');
  });

  it('rejects a non-owner caller on user.reopened (SEC-002 IDOR fix)', async () => {
    const { supportService } = await import('./service');
    // An attacker who only knows the ticket id cannot reopen another user's
    // ticket — the service itself enforces ownership, not just the route.
    await expect(supportService.setStatus('user-attacker', 'ticket-1', 'user.reopened'))
      .rejects.toThrow(/not your ticket/i);
  });

  it('transitions an open ticket to resolved on staff.resolved', async () => {
    // Override the mock to return an open ticket for this test
    const { db } = await import('@addis/db');
    const chain = (db.select as any)();
    chain.where.mockResolvedValueOnce([{ ...TICKET_ROW, status: 'open' }]);
    const { supportService } = await import('./service');
    const result = await supportService.setStatus('admin-1', 'ticket-1', 'staff.resolved');
    expect(result.to).toBe('resolved');
  });

  it('throws NotFoundError when the ticket does not exist', async () => {
    const { db } = await import('@addis/db');
    const chain = (db.select as any)();
    chain.where.mockResolvedValueOnce([]);
    const { supportService } = await import('./service');
    // Use the owner id so the IDOR check (which runs after the NotFoundError
    // check) doesn't fire even if the test is reordered in the future.
    await expect(supportService.setStatus('user-owner-1', 'nonexistent', 'user.reopened'))
      .rejects.toThrow(/not found/i);
  });
});
