import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Ticket service tests. The authorization (owner vs. attacker) happens in the
 * route handler via getTicket(), not in the service — the service's setStatus
 * assumes the caller has already been authorized. These tests verify the
 * state-machine transitions and DB updates work correctly.
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

  it('transitions a resolved ticket to open on user.reopened', async () => {
    const { supportService } = await import('./service');
    const result = await supportService.setStatus('user-1', 'ticket-1', 'user.reopened');
    expect(result.to).toBe('open');
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
    await expect(supportService.setStatus('user-1', 'nonexistent', 'user.reopened'))
      .rejects.toThrow(/not found/i);
  });
});
