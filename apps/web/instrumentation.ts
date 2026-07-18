export async function register() {
  const { loadEnv } = await import('@addis/shared');
  loadEnv(); // throws and crashes boot on invalid config — intentional fail-fast

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const Sentry = await import('@sentry/nextjs');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0.1,
      release: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',
    });
  }
}
