import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Two-factor login flow tests. Covers the C1 fix:
 *   - identityService.login throws TwoFactorRequiredError when user.twoFactorEnabled is true
 *     and no twoFactorCode is supplied
 *   - identityService.login succeeds when the correct 6-digit code is supplied
 *   - identityService.login throws UnauthorizedError when an incorrect code is supplied
 *
 * We mock @addis/db to return a user with twoFactorEnabled=true and a known secret,
 * then exercise identityService.login() directly.
 */

vi.mock('@addis/db', () => {
  const user = {
    id: 'user-admin-1',
    phone: '+251911100001',
    passwordHash: '$2a$12$mockhash', // verifyPassword is mocked to return true
    role: 'platform_admin',
    isActive: true,
    deletedAt: null,
    twoFactorEnabled: true,
    twoFactorSecret: 'JBSWY3DPEHPK3PXP', // well-known test TOTP secret
    tokenVersion: 0,
    tosVersion: 'v2_0',
  };
  // insert().values() returns a thenable that also has .catch() — mock it as a
  // promise so the audit-outbox inserts in login() don't crash.
  const insertChain = {
    values: vi.fn(() => Promise.resolve()),
  };
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([user])),
        })),
      })),
      insert: vi.fn(() => insertChain),
    },
    schema: new Proxy({}, { get: () => ({}) }),
  };
});

vi.mock('@addis/shared', async () => {
  const actual = await vi.importActual('@addis/shared');
  return {
    ...actual,
    // verifyPassword always returns true for these tests — the password itself isn't
    // what we're exercising, only the 2FA branching logic on top of a valid password.
    verifyPassword: vi.fn(async () => true),
    hashPassword: vi.fn(async (pw: string) => `mock-hash-of-${pw}`),
    isPasswordBreached: vi.fn(async () => false),
  };
});

vi.mock('jose', () => ({
  SignJWT: class {
    private payload: Record<string, unknown> = {};
    private prot: Record<string, string> = {};
    setProtectedHeader(h: Record<string, string>) { this.prot = h; return this; }
    setIssuedAt() { return this; }
    setExpirationTime() { return this; }
    sign() { return Promise.resolve('mock.jwt.token'); }
    constructor(payload: Record<string, unknown>) { this.payload = payload; }
  },
  jwtVerify: vi.fn(),
}));

vi.mock('otplib', () => ({
  authenticator: {
    check: vi.fn((code: string, secret: string) => {
      // For the test secret 'JBSWY3DPEHPK3PXP', accept code '123456' as valid, reject all others.
      return code === '123456' && secret === 'JBSWY3DPEHPK3PXP';
    }),
    generateSecret: vi.fn(() => 'NEWSECRET'),
    keyuri: vi.fn(() => 'otpauth://totp/mock'),
  },
}));

describe('identityService.login 2FA flow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws TwoFactorRequiredError when 2FA is enabled and no code is supplied', async () => {
    const { identityService } = await import('./service');
    const { TwoFactorRequiredError } = await import('@addis/shared');
    await expect(identityService.login('+251911100001', 'any-password', 'ua', '1.2.3.4'))
      .rejects.toBeInstanceOf(TwoFactorRequiredError);
  });

  it('succeeds when the correct 6-digit code is supplied', async () => {
    const { identityService } = await import('./service');
    const result = await identityService.login('+251911100001', 'any-password', 'ua', '1.2.3.4', '123456');
    expect(result.user.id).toBe('user-admin-1');
    expect(result.accessToken).toBe('mock.jwt.token');
    expect(result.requiresTosAcceptance).toBe(false);
  });

  it('throws UnauthorizedError when an incorrect code is supplied', async () => {
    const { identityService } = await import('./service');
    const { UnauthorizedError } = await import('@addis/shared');
    await expect(identityService.login('+251911100001', 'any-password', 'ua', '1.2.3.4', '000000'))
      .rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('identityService.login with 2FA disabled', () => {
  it('succeeds without a code when the user does not have 2FA enabled', async () => {
    // Re-mock @addis/db for this test to return a user with twoFactorEnabled=false
    vi.resetModules();
    vi.doMock('@addis/db', () => ({
      db: {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve([{
              id: 'user-rider-1',
              phone: '+251922555999',
              passwordHash: 'mock',
              role: 'rider',
              isActive: true,
              deletedAt: null,
              twoFactorEnabled: false,
              twoFactorSecret: null,
              tokenVersion: 0,
              tosVersion: 'v2_0',
            }])),
          })),
        })),
        insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
      },
      schema: new Proxy({}, { get: () => ({}) }),
    }));
    const { identityService } = await import('./service');
    const result = await identityService.login('+251922555999', 'any-password', 'ua', '1.2.3.4');
    expect(result.user.id).toBe('user-rider-1');
    expect(result.accessToken).toBe('mock.jwt.token');
  });
});
