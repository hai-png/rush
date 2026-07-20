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
