import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => cleanup());
afterEach(() => vi.unstubAllEnvs());

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })),
});

const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  NEXTAUTH_SECRET: 'test-nextauth-secret-32chars-minimum-aaaa-bbbb',
  CRON_SECRET: 'test-cron-secret-32chars-minimum-cccc-dddd',
  JWT_SECRET: 'test-jwt-secret-32chars-minimum-eeee-ffff',
  CURSOR_SECRET: 'test-cursor-secret-32chars-minimum-gggg-hhhh',
  DATABASE_URL: 'postgres://stub:stub@localhost:5432/stub',
  NEXTAUTH_URL: 'https://stub.addisride.et',
  TELEBIRR_NOTIFY_URL: 'https://stub.addisride.et/api/v1/webhooks/telebirr/notify',
  TELEBIRR_REDIRECT_URL: 'https://stub.addisride.et/checkout/complete',
  SENTRY_DSN: 'https://abcdef1234567890@sentry.example.com/1',
  TELEBIRR_ENV: 'testbed',
  TELEBIRR_PUBLIC_KEY: 'test-telebirr-public-key-stub',
  TELEBIRR_APP_ID: 'test-telebirr-app-id',
  TELEBIRR_SHORT_CODE: 'test-short-code',
  TELEBIRR_FABRIC_APP_ID: 'test-fabric-app-id',
  TELEBIRR_APP_SECRET: 'test-telebirr-app-secret-32-chars-minimum',
  TELEBIRR_MERCHANT_APP_ID: 'test-merchant-app-id',
  TELEBIRR_MERCHANT_CODE: 'test-merchant-code',
  TELEBIRR_PRIVATE_KEY: 'test-telebirr-private-key-stub-32-chars-min',
  S3_ENDPOINT: 'https://s3.stub.addisride.et',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'stub-bucket',
  S3_ACCESS_KEY_ID: 'stub-access-key-min-16-chars',
  S3_SECRET_ACCESS_KEY: 'stub-secret-key-min-32-chars-long!!',
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  vi.stubEnv(key, value);
}

import { resetEnv } from './packages/shared/src/env';
resetEnv();
