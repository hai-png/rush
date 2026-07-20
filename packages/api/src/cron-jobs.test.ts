import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Cron registry tests. Verifies the consolidated CRON_JOBS array (the single source
 * of truth shared by the HTTP cron routes and the worker setInterval loops):
 *   - Every job has a unique name
 *   - Every job has a route segment matching its name
 *   - Every job has a positive intervalMs
 *   - CRON_JOBS_BY_NAME lookup is consistent with the array
 *   - The set of job names matches what the HTTP routes expect
 */

describe('CRON_JOBS registry', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes the full set of cron jobs the system expects', async () => {
    const { CRON_JOBS } = await import('./cron-jobs');
    const names = CRON_JOBS.map((j) => j.name).sort();
    // FA: added 'anchor-audit-chain', 'verify-audit-chain-anchors' (Follow-up 1),
    // and 'cleanup-old-outbox-and-notifications' (Follow-up 3).
    expect(names).toEqual([
      'anchor-audit-chain',
      'archive-old-records',
      'auto-close-tickets',
      'cleanup-old-outbox-and-notifications',
      'cleanup-pending-subscriptions',
      'cleanup-stale-payments',
      'corporate-reset-monthly',
      'expire-seat-releases',
      'expire-subscriptions',
      'process-refund-retries',
      'reconcile-claims',
      'reconcile-payments',
      'retention-cleanup',
      'send-expiry-reminders',
      'verify-audit-chain-anchors',
    ]);
  });

  it('every job has a unique name', async () => {
    const { CRON_JOBS } = await import('./cron-jobs');
    const names = CRON_JOBS.map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every job has a matching route segment and a positive interval', async () => {
    const { CRON_JOBS } = await import('./cron-jobs');
    for (const job of CRON_JOBS) {
      expect(job.route).toBe(job.name);
      expect(job.intervalMs).toBeGreaterThan(0);
      expect(typeof job.run).toBe('function');
    }
  });

  it('CRON_JOBS_BY_NAME is a complete lookup table', async () => {
    const { CRON_JOBS, CRON_JOBS_BY_NAME } = await import('./cron-jobs');
    for (const job of CRON_JOBS) {
      expect(CRON_JOBS_BY_NAME.get(job.name)).toBe(job);
    }
    expect(CRON_JOBS_BY_NAME.size).toBe(CRON_JOBS.length);
  });

  it('rejects unknown job names via CRON_JOBS_BY_NAME.get()', async () => {
    const { CRON_JOBS_BY_NAME } = await import('./cron-jobs');
    expect(CRON_JOBS_BY_NAME.get('nonexistent-job')).toBeUndefined();
  });
});

describe('withLock', () => {
  it('returns skipped:true when the advisory lock is already held', async () => {
    vi.resetModules();
    vi.doMock('@addis/db', () => ({
      db: {
        transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
          const tx = {
            execute: vi.fn(async () => [{ locked: false }]),
          };
          return fn(tx);
        }),
      },
      schema: new Proxy({}, { get: () => ({}) }),
    }));
    vi.doMock('../modules/admin/audit', () => ({ writeAudit: vi.fn() }));
    const { withLock } = await import('./cron-jobs');
    const result = await withLock('test-job', async () => 'should-not-run');
    expect(result).toEqual({ skipped: true, reason: 'lock-held' });
  });

  it('runs the job and writes an audit entry when the lock is acquired', async () => {
    vi.resetModules();
    const writeAuditMock = vi.fn();
    vi.doMock('@addis/db', () => ({
      db: {
        transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
          const tx = {
            // withLock now casts the execute() result directly to an array;
            // return the array shape (not { rows: [...] }).
            execute: vi.fn(async () => [{ locked: true }]),
          };
          return fn(tx);
        }),
      },
      schema: new Proxy({}, { get: () => ({}) }),
    }));
    vi.doMock('../modules/admin/audit', () => ({ writeAudit: writeAuditMock }));
    const { withLock } = await import('./cron-jobs');
    const result = await withLock('test-job', async () => ({ count: 5 }));
    expect(result).toEqual({ ok: true, result: { count: 5 }, at: expect.any(String) });
    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    const entry = writeAuditMock.mock.calls[0][1];
    expect(entry.action).toBe('cron.test-job');
    expect(entry.entityType).toBe('cron');
  });
});
