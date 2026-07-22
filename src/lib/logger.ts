
import pino from 'pino';
import { loadEnv } from '@/lib/env';

const env = loadEnv();

const logger = pino({
  level: process.env.LOG_LEVEL || (env.NODE_ENV === 'production' ? 'info' : 'debug'),
  base: { app: 'addis-ride', env: env.NODE_ENV },
});

export { logger };
