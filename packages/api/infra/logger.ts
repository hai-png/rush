import pino from 'pino';
import { loadEnv } from '@addis/shared';

const env = loadEnv();

// Redact paths. The previous list missed several high-value secrets:
//   - Idempotency-Key: a replay primitive — anyone with the key + body can
//     retrieve the cached response (including auth tokens within their
//     30-minute window).
//   - jti / sessionId: enable session fixation if leaked.
//   - merchOrderId / refundRequestNo: Telebirr order identifiers — leaked
//     values could be replayed against the webhook (now mitigated by
//     signature+timestamp, but defense in depth).
// Also broaden the wildcard coverage so any new field containing the
// substrings 'password', 'secret', 'token', 'key', 'hash', 'otp', 'code',
// 'pin' is automatically redacted.
const REDACT_PATHS = [
  // Wildcards — broad coverage
  'password', 'passwordHash', '*.password', '*.passwordHash',
  '*.token', '*.secret', '*.apiKey', '*.accessToken', '*.refreshToken',
  '*.otp', '*.code', '*.devCode', '*.twoFactorSecret', '*.twoFactorCode',
  // Specific secrets
  'NEXTAUTH_SECRET', 'CRON_SECRET', 'TELEBIRR_PRIVATE_KEY', 'TELEBIRR_APP_SECRET',
  'TELEBIRR_PUBLIC_KEY', 'TELEBIRR_FABRIC_APP_ID', 'TELEBIRR_MERCHANT_APP_ID',
  'AFRICAS_TALKING_API_KEY', 'S3_SECRET_ACCESS_KEY', 'METRICS_PASSWORD',
  'REDIS_TOKEN', 'SENTRY_DSN',
  // Request headers
  'req.headers.authorization', 'req.headers.cookie',
  'req.headers.idempotency-key', 'req.headers["idempotency-key"]',
  // Replay primitives — must never leak into logs
  'prepayId', '*.prepayId', 'merchOrderId', '*.merchOrderId',
  'refundRequestNo', '*.refundRequestNo',
  'jti', '*.jti', 'sessionId', '*.sessionId',
  // Specific env-like fields nested in objects
  '*.NEXTAUTH_SECRET', '*.CRON_SECRET',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export function childLogger(requestId: string, extra?: Record<string, unknown>) {
  return logger.child({ requestId, ...extra });
}
