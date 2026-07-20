import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@addis/db', () => {
  const tx = { update: vi.fn(), insert: vi.fn(), select: vi.fn() };
  return { db: { transaction: (fn: any) => fn(tx), select: vi.fn(), insert: vi.fn(), update: vi.fn() }, schema: new Proxy({}, { get: () => ({}) }) };
});
vi.mock('@addis/payments', () => ({ getPaymentProvider: () => ({ createCheckout: vi.fn().mockResolvedValue({ status: 'checkout', checkoutUrl: 'https://x', prepayId: 'p1' }) }) }));

vi.mock('@addis/shared', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('@addis/shared');
  return {
    ...actual,
    loadEnv: () => ({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://stub:stub@localhost:5432/stub',
      NEXTAUTH_SECRET: 'test-nextauth-secret-32chars-minimum-aaaa-bbbb',
      NEXTAUTH_URL: 'https://stub.addisride.et',
      CRON_SECRET: 'test-cron-secret-32chars-minimum-cccc-dddd',
      TELEBIRR_ENV: 'testbed' as const,
      TELEBIRR_NOTIFY_URL: 'https://stub.addisride.et/api/v1/webhooks/telebirr/notify',
      TELEBIRR_REDIRECT_URL: 'https://stub.addisride.et/checkout/complete',
      TELEBIRR_FABRIC_APP_ID: 'test-fabric-app-id',
      TELEBIRR_APP_SECRET: 'test-telebirr-app-secret-32-chars-minimum',
      TELEBIRR_MERCHANT_APP_ID: 'test-merchant-app-id',
      TELEBIRR_MERCHANT_CODE: 'test-merchant-code',
      TELEBIRR_PRIVATE_KEY: 'test-telebirr-private-key-stub-32-chars-min',
      TELEBIRR_PUBLIC_KEY: 'test-telebirr-public-key-stub',
      S3_ENDPOINT: 'https://s3.stub.addisride.et',
      S3_BUCKET: 'stub-bucket',
      S3_ACCESS_KEY_ID: 'stub-access-key-min-16-chars',
      S3_SECRET_ACCESS_KEY: 'stub-secret-key-min-32-chars-long!!',
      BCRYPT_COST: 12,
      LOG_LEVEL: 'info' as const,
      DPO_EMAIL: 'dpo@addisride.et',
    }),
  };
});

describe('marketplaceService.claim', () => {
  beforeEach(() => vi.clearAllMocks());

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
