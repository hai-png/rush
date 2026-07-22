
type Env = {
  NODE_ENV: 'development' | 'production' | 'test';
  DATABASE_URL: string;
  AUTH_SECRET: string;
  CRON_SECRET: string;
  CURRENT_TOS_VERSION: string;
  TELEBIRR_ENV: 'testbed' | 'production' | 'mock';
  TELEBIRR_FABRIC_APP_ID: string;
  TELEBIRR_APP_SECRET: string;
  TELEBIRR_MERCHANT_APP_ID: string;
  TELEBIRR_MERCHANT_CODE: string;
  TELEBIRR_PRIVATE_KEY: string;
  TELEBIRR_PUBLIC_KEY: string;
  TELEBIRR_NOTIFY_URL: string;
  TELEBIRR_REDIRECT_URL: string;
  CBE_ACCOUNT_NUMBER: string;
  CBE_ACCOUNT_NAME: string;
  CBE_BANK_BRANCH: string;
  APP_BASE_URL: string;
  UPLOAD_DIR: string;
  UPLOAD_MAX_BYTES: number;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_FROM: string;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  SENTRY_DSN: string;
  REDIS_URL: string;
};

let cachedEnv: Env | null = null;

export function loadEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret || authSecret.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AUTH_SECRET must be set in production (>= 32 chars)');
    }
  }

  // P0-7 / SEC-001: in production, if TELEBIRR_ENV is set to 'production' or
  // 'testbed' but the required Telebirr credentials are missing, fail loudly
  // instead of silently falling back to the mock provider. The mock provider
  // accepts 'sign: mock-signature' on webhooks — silently using it in prod
  // would let any attacker forge payment-settlement webhooks for free.
  const telebirrEnv: Env['TELEBIRR_ENV'] =
    (process.env.TELEBIRR_ENV as any) === 'production' ? 'production'
    : (process.env.TELEBIRR_ENV as any) === 'testbed' ? 'testbed'
    : 'mock';

  const hasRealTelebirr = !!(
    process.env.TELEBIRR_FABRIC_APP_ID &&
    process.env.TELEBIRR_APP_SECRET &&
    process.env.TELEBIRR_MERCHANT_APP_ID &&
    process.env.TELEBIRR_MERCHANT_CODE &&
    process.env.TELEBIRR_PRIVATE_KEY &&
    process.env.TELEBIRR_PUBLIC_KEY
  );

  let effectiveTelebirr: Env['TELEBIRR_ENV'] = hasRealTelebirr ? telebirrEnv : 'mock';
  if (process.env.NODE_ENV === 'production' && telebirrEnv !== 'mock' && !hasRealTelebirr) {
    throw new Error(
      `TELEBIRR_ENV=${telebirrEnv} but required Telebirr credentials are missing. ` +
      `Either set all TELEBIRR_* credentials (FABRIC_APP_ID, APP_SECRET, MERCHANT_APP_ID, ` +
      `MERCHANT_CODE, PRIVATE_KEY, PUBLIC_KEY) or explicitly set TELEBIRR_ENV=mock for a ` +
      `non-payment-receiving deployment. Refusing to start with mock provider in production.`
    );
  }

  // P1-1 / SEC-004: in production, CRON_SECRET must be set and must NOT equal
  // the dev fallback string. The cron endpoint is CSRF-exempt, TOS-exempt,
  // idempotency-exempt, and requires no session — accepting the dev secret
  // in production would let any attacker trigger refund storms and mass
  // subscription expirations.
  const cronSecret = process.env.CRON_SECRET;
  const DEV_CRON_FALLBACK = 'dev-only-cron-secret-32-chars';
  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret || cronSecret.length < 32) {
      throw new Error('CRON_SECRET must be set in production (>= 32 chars)');
    }
    if (cronSecret === DEV_CRON_FALLBACK) {
      throw new Error('CRON_SECRET must not equal the dev fallback string in production');
    }
  }

  cachedEnv = {
    NODE_ENV: (process.env.NODE_ENV as any) || 'development',
    DATABASE_URL: process.env.DATABASE_URL || 'file:./db/custom.db',
    AUTH_SECRET: authSecret || 'dev-only-insecure-secret-32-chars-min',
    CRON_SECRET: cronSecret || DEV_CRON_FALLBACK,
    CURRENT_TOS_VERSION: process.env.CURRENT_TOS_VERSION || '2026-01-01',
    TELEBIRR_ENV: effectiveTelebirr,
    TELEBIRR_FABRIC_APP_ID: process.env.TELEBIRR_FABRIC_APP_ID || '',
    TELEBIRR_APP_SECRET: process.env.TELEBIRR_APP_SECRET || '',
    TELEBIRR_MERCHANT_APP_ID: process.env.TELEBIRR_MERCHANT_APP_ID || '',
    TELEBIRR_MERCHANT_CODE: process.env.TELEBIRR_MERCHANT_CODE || '',
    TELEBIRR_PRIVATE_KEY: (process.env.TELEBIRR_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    TELEBIRR_PUBLIC_KEY: (process.env.TELEBIRR_PUBLIC_KEY || '').replace(/\\n/g, '\n'),
    TELEBIRR_NOTIFY_URL: process.env.TELEBIRR_NOTIFY_URL || '',
    TELEBIRR_REDIRECT_URL: process.env.TELEBIRR_REDIRECT_URL || '',
    CBE_ACCOUNT_NUMBER: process.env.CBE_ACCOUNT_NUMBER || '',
    CBE_ACCOUNT_NAME: process.env.CBE_ACCOUNT_NAME || '',
    CBE_BANK_BRANCH: process.env.CBE_BANK_BRANCH || '',
    APP_BASE_URL: process.env.APP_BASE_URL || 'http://localhost:3000',
    UPLOAD_DIR: process.env.UPLOAD_DIR || './db/uploads',
    UPLOAD_MAX_BYTES: Number(process.env.UPLOAD_MAX_BYTES) || 10 * 1024 * 1024,
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
    TWILIO_FROM: process.env.TWILIO_FROM || '',
    RESEND_API_KEY: process.env.RESEND_API_KEY || '',
    RESEND_FROM: process.env.RESEND_FROM || '',
    // Reserved for production hardening — currently read but not wired up.
    // See DEPLOYMENT.md "Production hardening status" table.
    SENTRY_DSN: process.env.SENTRY_DSN || '',
    REDIS_URL: process.env.REDIS_URL || '',
  };
  return cachedEnv;
}

export const CURRENT_TOS_VERSION = loadEnv().CURRENT_TOS_VERSION;
export const TWO_FA_REQUIRED_ROLES = ['corporate_admin', 'platform_admin'] as const;
