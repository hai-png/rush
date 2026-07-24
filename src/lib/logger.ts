import pino from 'pino';

// CI fix: do NOT call loadEnv() at module load time. logger.ts is imported
const nodeEnv = process.env.NODE_ENV || 'development';

const logger = pino({
  level: process.env.LOG_LEVEL || (nodeEnv === 'production' ? 'info' : 'debug'),
  base: { app: 'addis-ride', env: nodeEnv },
});

export { logger };

