import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => cleanup());

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })),
});

process.env.NODE_ENV ??= 'test';

process.env.NEXTAUTH_SECRET ??= 'test-nextauth-secret-32chars-minimum-aaaa-bbbb';
process.env.CRON_SECRET ??= 'test-cron-secret-32chars-minimum-cccc-dddd';
process.env.JWT_SECRET ??= 'test-jwt-secret-32chars-minimum-eeee-ffff';

process.env.DATABASE_URL ??= 'postgres://stub:stub@localhost:5432/stub';
process.env.NEXTAUTH_URL ??= 'https://stub.addisride.et';
process.env.TELEBIRR_NOTIFY_URL ??= 'https://stub.addisride.et/api/v1/webhooks/telebirr/notify';
process.env.TELEBIRR_REDIRECT_URL ??= 'https://stub.addisride.et/checkout/complete';
process.env.SENTRY_DSN ??= 'https://abcdef1234567890@sentry.example.com/1';

process.env.TELEBIRR_ENV ??= 'testbed';

process.env.TELEBIRR_PUBLIC_KEY ??= 'test-telebirr-public-key-stub';
process.env.TELEBIRR_APP_ID ??= 'test-telebirr-app-id';
process.env.TELEBIRR_SHORT_CODE ??= 'test-short-code';

process.env.TELEBIRR_FABRIC_APP_ID ??= 'test-fabric-app-id';
process.env.TELEBIRR_APP_SECRET ??= 'test-telebirr-app-secret-32-chars-minimum';
process.env.TELEBIRR_MERCHANT_APP_ID ??= 'test-merchant-app-id';
process.env.TELEBIRR_MERCHANT_CODE ??= 'test-merchant-code';
process.env.TELEBIRR_PRIVATE_KEY ??= 'test-telebirr-private-key-stub-32-chars-min';

process.env.S3_ENDPOINT ??= 'https://s3.stub.addisride.et';
process.env.S3_REGION ??= 'us-east-1';
process.env.S3_BUCKET ??= 'stub-bucket';
process.env.S3_ACCESS_KEY_ID ??= 'stub-access-key-min-16-chars';
process.env.S3_SECRET_ACCESS_KEY ??= 'stub-secret-key-min-32-chars-long!!';

import { resetEnv } from './packages/shared/src/env';
resetEnv();
