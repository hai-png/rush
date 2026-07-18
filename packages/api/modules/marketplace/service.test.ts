import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@addis/db', () => {
  const tx = { update: vi.fn(), insert: vi.fn(), select: vi.fn() };
  return { db: { transaction: (fn: any) => fn(tx), select: vi.fn(), insert: vi.fn(), update: vi.fn() }, schema: new Proxy({}, { get: () => ({}) }) };
});
vi.mock('@addis/payments', () => ({ getPaymentProvider: () => ({ createCheckout: vi.fn().mockResolvedValue({ status: 'checkout', checkoutUrl: 'https://x', prepayId: 'p1' }) }) }));

describe('marketplaceService.claim', () => {
  it('rejects claiming your own released seat', async () => {
    const { db } = await import('@addis/db');
    const txMock = {
      update: vi.fn().mockReturnValue({ set: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: 'r1', riderId: 'rider-1', status: 'open', refundAmount: '60.00', routeId: 'route-1', window: 'morning' }]) }) }) }),
      insert: vi.fn(),
    };
    (db.transaction as any) = (fn: any) => fn(txMock);
    const { marketplaceService } = await import('./service');
    await expect(marketplaceService.claim('rider-1', { seatReleaseId: 'r1', paymentMethod: 'telebirr' }))
      .rejects.toThrow('Cannot claim your own released seat');
  });

  it('throws ConflictError when CAS update matches zero rows (already claimed)', async () => {
    const { db } = await import('@addis/db');
    const txMock = { update: vi.fn().mockReturnValue({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }) };
    (db.transaction as any) = (fn: any) => fn(txMock);
    const { marketplaceService } = await import('./service');
    await expect(marketplaceService.claim('rider-2', { seatReleaseId: 'r1', paymentMethod: 'telebirr' }))
      .rejects.toThrow('Seat already claimed');
  });
});
