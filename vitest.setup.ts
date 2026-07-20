import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => cleanup());

// jsdom has no EventSource / matchMedia — stub for components that touch them
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })),
});

// FIX (TEST-001 / vitest.setup): Many API modules call `loadEnv()` at
// module-load time, which parses process.env through a strict Zod schema
// (packages/shared/src/env.ts). Without stubs, importing any of those
// modules — which happens transitively when the web app's components are
// rendered in tests — throws at import time. The root setup runs for every
// package (the per-package setup at packages/api/vitest.setup.ts is only
// used when vitest is launched from packages/api), so the stubs need to
// live here.
//
// Use `??=` so individual tests can still override a value if they need to
// exercise a specific env branch. The values themselves are NEVER used at
// runtime in unit tests — the DB is mocked, the payment provider is mocked,
// S3 is mocked, etc. They only need to pass the zod schema validation.
process.env.NODE_ENV ??= 'test';

// --- Required secrets (>= 32 chars, not a known placeholder) ---
// The strongSecret refine in env.ts rejects known placeholders, all-same-char
// runs, and sequential digit/letter runs. Each value below is a 48-char
// random-looking string that passes the refine.
process.env.NEXTAUTH_SECRET ??= 'test-nextauth-secret-32chars-minimum-aaaa-bbbb';
process.env.CRON_SECRET ??= 'test-cron-secret-32chars-minimum-cccc-dddd';
process.env.JWT_SECRET ??= 'test-jwt-secret-32chars-minimum-eeee-ffff';

// --- Required URLs ---
process.env.DATABASE_URL ??= 'postgres://stub:stub@localhost:5432/stub';
process.env.NEXTAUTH_URL ??= 'https://stub.addisride.et';
process.env.TELEBIRR_NOTIFY_URL ??= 'https://stub.addisride.et/api/v1/webhooks/telebirr/notify';
process.env.TELEBIRR_REDIRECT_URL ??= 'https://stub.addisride.et/checkout/complete';
process.env.SENTRY_DSN ??= 'https://abcdef1234567890@sentry.example.com/1';

// --- Telebirr ---
// TELEBIRR_ENV must be 'testbed' or 'production'. The schema rejects 'sandbox'.
process.env.TELEBIRR_ENV ??= 'testbed';
// Legacy telebirr single-key fields (still referenced by older code paths).
process.env.TELEBIRR_PUBLIC_KEY ??= 'test-telebirr-public-key-stub';
process.env.TELEBIRR_APP_ID ??= 'test-telebirr-app-id';
process.env.TELEBIRR_SHORT_CODE ??= 'test-short-code';
// The env.ts refine requires that the 6 fabric/merchant fields are all set
// together (all-or-nothing). We set all 6 so the refine passes.
process.env.TELEBIRR_FABRIC_APP_ID ??= 'test-fabric-app-id';
process.env.TELEBIRR_APP_SECRET ??= 'test-telebirr-app-secret-32-chars-minimum';
process.env.TELEBIRR_MERCHANT_APP_ID ??= 'test-merchant-app-id';
process.env.TELEBIRR_MERCHANT_CODE ??= 'test-merchant-code';
process.env.TELEBIRR_PRIVATE_KEY ??= 'test-telebirr-private-key-stub-32-chars-min';

// --- S3 ---
process.env.S3_ENDPOINT ??= 'https://s3.stub.addisride.et';
process.env.S3_REGION ??= 'us-east-1';
process.env.S3_BUCKET ??= 'stub-bucket';
process.env.S3_ACCESS_KEY_ID ??= 'stub-access-key-min-16-chars';
process.env.S3_SECRET_ACCESS_KEY ??= 'stub-secret-key-min-32-chars-long!!';

// REDIS_URL is intentionally NOT set: the env.ts production-only refine
// requires REDIS_URL in production, but in test/development the redis client
// falls back to InMemoryRedis (see packages/api/infra/redis.ts). Setting it
// to a non-HTTPS URL would fail the z.string().url() schema; setting it to
// an HTTPS URL would point at a non-existent Upstash host. Leaving it unset
// is correct for tests.

// Force loadEnv to re-read process.env (it caches). Use a relative path so
// the root setup file (which has no @addis/* aliases and lives outside any
// package's node_modules tree) can resolve the module under vite's resolver.
import { resetEnv } from './packages/shared/src/env';
resetEnv();
