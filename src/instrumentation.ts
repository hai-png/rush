import { logger } from '@/lib/logger';

// Guard against the Edge Runtime, which doesn't support process.on() or
// the Node.js process event API. Next.js loads instrumentation.ts in both
// the Node.js runtime and the Edge Runtime — we only want to register
// shutdown handlers in the Node.js runtime.
const isNodeRuntime = typeof process !== 'undefined' && typeof process.on === 'function' && process.versions?.node != null;

export async function register() {
  if (!isNodeRuntime) return; // Edge Runtime — no-op

  try {
    const { initSentry } = await import('@/lib/sentry');
    initSentry();
  } catch (err) {
    // Sentry not installed or failed to init — non-fatal.
    logger.error({ err: (err as Error).message }, '[instrumentation] sentry init failed');
  }

  // Lazy-import db only in the Node runtime so Edge doesn't try to load Prisma.
  const { db } = await import('@/lib/db');

  logger.info('[instrumentation] server starting');

  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return; // second signal forces exit
    shuttingDown = true;
    logger.info({ signal }, '[instrumentation] graceful shutdown beginning');
    try {
      // Give in-flight requests up to 10s to drain (Next.js handles this
      // internally on SIGTERM, but we add our own timeout as a safety net).
      await Promise.race([
        db.$disconnect(),
        new Promise(resolve => setTimeout(resolve, 10_000)),
      ]);
      logger.info('[instrumentation] prisma disconnected, exiting');
    } catch (err) {
      logger.error({ err: (err as Error).message }, '[instrumentation] shutdown error');
    }
    if (typeof process.exit === 'function') process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Catch unhandled rejections so they don't crash the
  // process silently. Particularly important for the audit queue and
  // scheduler timers, which can throw outside their try/catch.
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: String(reason) }, '[instrumentation] unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err: err.message, stack: err.stack }, '[instrumentation] uncaughtException');
    // For uncaughtException we exit — the process state is undefined.
    // k8s/systemd will restart us.
    if (typeof process.exit === 'function') process.exit(1);
  });
}
