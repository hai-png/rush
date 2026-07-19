/**
 * Test env setup for @addis/api unit tests.
 *
 * The env.ts schema requires real env vars (DATABASE_URL, NEXTAUTH_SECRET,
 * TELEBIRR_*, S3_*, etc.) to be present and well-formed. In production this
 * is correct — the process must fail to start if env is missing. In tests,
 * we set stub values so loadEnv() succeeds and the modules under test can
 * be imported.
 *
 * These values are NEVER used at runtime in unit tests — the DB is mocked,
 * the payment provider is mocked, S3 is mocked, etc. They only need to
 * pass the zod schema validation.
 */
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgres://stub:stub@localhost:5432/stub';
process.env.NEXTAUTH_SECRET ??= 'test-stub-secret-32-chars-minimum-length';
process.env.NEXTAUTH_URL ??= 'https://stub.addisride.et';
process.env.CRON_SECRET ??= 'test-stub-cron-secret-32-chars-min';
process.env.TELEBIRR_ENV ??= 'testbed';
process.env.TELEBIRR_NOTIFY_URL ??= 'https://stub.addisride.et/api/v1/webhooks/telebirr/notify';
process.env.TELEBIRR_REDIRECT_URL ??= 'https://stub.addisride.et/checkout/complete';
process.env.S3_ENDPOINT ??= 'https://s3.stub.addisride.et';
process.env.S3_BUCKET ??= 'stub-bucket';
process.env.S3_ACCESS_KEY_ID ??= 'stub-access-key-min-16-chars';
process.env.S3_SECRET_ACCESS_KEY ??= 'stub-secret-key-min-32-chars-long!!';

// Force loadEnv to re-read process.env (it caches).
import { resetEnv } from '@addis/shared';
resetEnv();
