import pino from 'pino';
import { loadEnv } from '@addis/shared';

const env = loadEnv();
const REDACT_PATHS = [
  'password', 'passwordHash', '*.token', '*.secret', 'prepayId', 'req.headers.authorization',
  'req.headers.cookie', 'NEXTAUTH_SECRET', 'TELEBIRR_PRIVATE_KEY', 'TELEBIRR_APP_SECRET',
];

/**
 * Build the pino options without the `transport` key when in production — passing
 * `transport: undefined` trips `exactOptionalPropertyTypes: true` because pino's
 * LoggerOptions declares `transport?` without `| undefined`. We construct the object
 * conditionally and spread it in so the key is genuinely absent in production.
 */
const opts: pino.LoggerOptions = {
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
};
if (env.NODE_ENV === 'development') {
  opts.transport = { target: 'pino-pretty' };
}

export const logger = pino(opts);

export function childLogger(requestId: string, extra?: Record<string, unknown>) {
  return logger.child({ requestId, ...extra });
}
