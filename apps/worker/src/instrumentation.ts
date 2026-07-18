import * as Sentry from '@sentry/node';
import { loadEnv } from '@addis/shared';

loadEnv(); // fail-fast on boot
Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV, tracesSampleRate: 0.1 });
