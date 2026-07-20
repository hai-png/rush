import pino from 'pino';
import { loadEnv } from '@addis/shared';

const env = loadEnv();

const REDACT_PATHS = [

  'password', 'passwordHash', '*.password', '*.passwordHash',
  '*.token', '*.secret', '*.apiKey', '*.accessToken', '*.refreshToken',
  '*.otp', '*.code', '*.devCode', '*.twoFactorSecret', '*.twoFactorCode',

  'NEXTAUTH_SECRET', 'CRON_SECRET', 'TELEBIRR_PRIVATE_KEY', 'TELEBIRR_APP_SECRET',
  'TELEBIRR_PUBLIC_KEY', 'TELEBIRR_FABRIC_APP_ID', 'TELEBIRR_MERCHANT_APP_ID',
  'AFRICAS_TALKING_API_KEY', 'S3_SECRET_ACCESS_KEY', 'METRICS_PASSWORD',
  'REDIS_TOKEN', 'SENTRY_DSN',

  'req.headers.authorization', 'req.headers.cookie',
  'req.headers.idempotency-key', 'req.headers["idempotency-key"]',

  'prepayId', '*.prepayId', 'merchOrderId', '*.merchOrderId',
  'refundRequestNo', '*.refundRequestNo',
  'jti', '*.jti', 'sessionId', '*.sessionId',

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
