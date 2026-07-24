import * as Sentry from '@sentry/nextjs';
import { loadEnv } from '@/lib/env';

export function initSentry(): void {
  const env = loadEnv();
  if (!env.SENTRY_DSN) return; // not configured — no-op

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
    sendDefaultPii: false,
    release: process.env.npm_package_version ?? 'dev',
  });
}

