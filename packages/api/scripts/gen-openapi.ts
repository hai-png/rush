/**
 * Generate the OpenAPI document for the Addis Ride API.
 *
 * FIX (ARCH-002): The previous setup referenced `tsx scripts/gen-openapi.ts`
 * in package.json but the script file did not exist — `bun run openapi:gen`
 * failed silently. The SDK then depended on `packages/api/openapi.json`
 * which was never generated, so `packages/sdk/src/schema.d.ts` was never
 * produced, and `import type { paths } from './schema'` in
 * `packages/sdk/src/index.ts` was an unresolvable import. The entire
 * frontend↔API typed-contract layer was fictional.
 *
 * This script imports the Hono app and writes the OpenAPI 3.1 document
 * to `packages/api/openapi.json`. Run via `bun run openapi:gen` from
 * the `packages/api` directory, or `bun run --cwd packages/api openapi:gen`
 * from the repo root.
 *
 * NOTE: only routes registered via `OpenAPIHono.openapi(createRoute(...), ...)`
 * appear in the document. Modules still using bare `Hono()` are invisible
 * to the SDK (see ARCH-003). The current set covers the subscription module
 * only; migrating the remaining modules is tracked as follow-up work.
 */

// Stub env vars so loadEnv() doesn't throw when the script runs outside a
// real deployment (e.g. in CI, or on a developer machine without a .env).
// These values are never used — the OpenAPI document is purely a route
// schema, not a runtime call — but the env schema requires them to be
// present and well-formed.
// Use 'production' for NODE_ENV during gen so pino doesn't try to load the
// pino-pretty transport (which isn't installed in the gen environment).
// The OpenAPI document doesn't depend on the logger's transport — only on
// the route registrations, which are unaffected by NODE_ENV.
process.env.NODE_ENV ??= 'production';
process.env.DATABASE_URL ??= 'postgres://stub:stub@localhost:5432/stub';
process.env.NEXTAUTH_SECRET ??= 'openapi-gen-stub-secret-32-chars-minimum-length';
process.env.NEXTAUTH_URL ??= 'https://stub.addisride.et';
process.env.CRON_SECRET ??= 'openapi-gen-stub-cron-secret-32-chars-min';
process.env.TELEBIRR_ENV ??= 'testbed';
process.env.TELEBIRR_NOTIFY_URL ??= 'https://stub.addisride.et/api/v1/webhooks/telebirr/notify';
process.env.TELEBIRR_REDIRECT_URL ??= 'https://stub.addisride.et/checkout/complete';
process.env.S3_ENDPOINT ??= 'https://s3.stub.addisride.et';
process.env.S3_BUCKET ??= 'stub-bucket';
process.env.S3_ACCESS_KEY_ID ??= 'stub-access-key-min-16-chars';
process.env.S3_SECRET_ACCESS_KEY ??= 'stub-secret-key-min-32-chars-long!!';
process.env.METRICS_PASSWORD ??= 'stub-metrics-password-16-chars';
process.env.REDIS_URL ??= 'https://stub-redis.addisride.et:6379';

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Dynamic import so the env stubs above run BEFORE the app module
// (which calls loadEnv() at module-load time).
const { app } = await import('../src/app');

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(__dirname, '..', 'openapi.json');

const doc = app.getOpenAPIDocument({
  openapi: '3.1.0',
  info: {
    title: 'Addis Ride API',
    version: '1.0.0',
    description: 'Shuttle-ride subscription platform for Addis Ababa. See packages/api/modules/*/routes.ts for the full route surface — modules not yet migrated to OpenAPIHono are not represented in this document.',
  },
  servers: [
    { url: '/api/v1', description: 'Relative to deployment origin' },
  ],
});

writeFileSync(outputPath, JSON.stringify(doc, null, 2) + '\n', 'utf-8');
console.log(`OpenAPI document written to ${outputPath}`);
console.log(`Routes documented: ${Object.keys(doc.paths ?? {}).length}`);

