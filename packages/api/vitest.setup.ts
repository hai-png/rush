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

import { resetEnv } from '@addis/shared';
resetEnv();
