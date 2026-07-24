
import pino from 'pino';

// CI fix: do NOT call loadEnv() at module load time. logger.ts is imported
// transitively by almost every module (including via api-routes.ts → gen-openapi).
// Calling loadEnv() here triggers the full env validation (including the C-4
// Telebirr mock-in-prod check) at import time, which breaks `openapi:gen` and
// `next build` in CI where NODE_ENV=production but no real Telebirr creds exist.
// Read env vars directly from process.env instead.
const nodeEnv = process.env.NODE_ENV || 'development';

const logger = pino({
  level: process.env.LOG_LEVEL || (nodeEnv === 'production' ? 'info' : 'debug'),
  base: { app: 'addis-ride', env: nodeEnv },
});

export { logger };
