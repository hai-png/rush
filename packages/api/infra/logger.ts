import pino from 'pino';
import { loadEnv } from '@addis/shared';

const env = loadEnv();
const REDACT_PATHS = [
  'password', 'passwordHash', '*.token', '*.secret', 'prepayId', 'req.headers.authorization',
  'req.headers.cookie', 'NEXTAUTH_SECRET', 'TELEBIRR_PRIVATE_KEY', 'TELEBIRR_APP_SECRET',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export function childLogger(requestId: string, extra?: Record<string, unknown>) {
  return logger.child({ requestId, ...extra });
}
