import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * OTP devCode gating tests. Covers the C7 follow-up:
 *   - devCode is undefined by default (even in non-production)
 *   - devCode is returned only when ALLOW_DEV_OTP=1 or ALLOW_DEV_OTP=true
 *   - devCode is undefined when ALLOW_DEV_OTP is set to any other value
 */

vi.mock('@addis/db', () => ({
  db: {
    // Chain: db.update(table).set(...).where(...) — return an object with .set() that returns .where()
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    insert: vi.fn(() => ({ values: vi.fn() })),
  },
  schema: new Proxy({}, { get: () => ({}) }),
}));

vi.mock('../../infra/redis', () => ({
  redis: {
    set: vi.fn(async () => 'OK'),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
    ttl: vi.fn(async () => 600),
  },
}));

vi.mock('@addis/sms', () => ({
  // The SMS provider always reports success in tests; the devCode gating logic
  // is independent of whether SMS delivery actually succeeded.
  smsProvider: { send: vi.fn(async () => true) },
}));

describe('otpService.send — devCode gating', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no ALLOW_DEV_OTP set
    delete process.env.ALLOW_DEV_OTP;
    // Use staging so the "production + AFRICAS_TALKING_API_KEY" 503 path doesn't fire
    process.env.NODE_ENV = 'staging';
    delete process.env.AFRICAS_TALKING_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns devCode: undefined by default (no ALLOW_DEV_OTP env var)', async () => {
    const { otpService } = await import('./otp');
    const result = await otpService.send('+251922555999', 'signup_verification');
    expect(result.devCode).toBeUndefined();
    expect(result.sent).toBe(true);
  });

  it('returns the code when ALLOW_DEV_OTP=1', async () => {
    process.env.ALLOW_DEV_OTP = '1';
    const { otpService } = await import('./otp');
    const result = await otpService.send('+251922555999', 'signup_verification');
    expect(result.devCode).toMatch(/^\d{6}$/);
  });

  it('returns the code when ALLOW_DEV_OTP=true', async () => {
    process.env.ALLOW_DEV_OTP = 'true';
    const { otpService } = await import('./otp');
    const result = await otpService.send('+251922555999', 'signup_verification');
    expect(result.devCode).toMatch(/^\d{6}$/);
  });

  it('returns devCode: undefined for any other ALLOW_DEV_OTP value', async () => {
    process.env.ALLOW_DEV_OTP = 'yes';
    const { otpService } = await import('./otp');
    const result = await otpService.send('+251922555999', 'signup_verification');
    expect(result.devCode).toBeUndefined();
  });
});
