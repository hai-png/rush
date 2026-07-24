import { logger } from '@/lib/logger';

function isNodeRuntime(): boolean {
  try {
    return typeof process !== 'undefined'
      && typeof process.on === 'function'
      && typeof process.versions === 'object'
      && process.versions !== null
      && typeof (process.versions as NodeJS.ProcessVersions).node === 'string';
  } catch {
    return false;
  }
}

export async function register() {
  if (!isNodeRuntime()) return;
  try {
    const { initSentry } = await import('@/lib/sentry');
    initSentry();
  } catch (err) {
    logger.error({ err: (err as Error).message }, '[instrumentation] sentry init failed');
  }

  const { db } = await import('@/lib/db');

  logger.info('[instrumentation] server starting');

  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, '[instrumentation] graceful shutdown beginning');
    try {
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

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: String(reason) }, '[instrumentation] unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err: err.message, stack: err.stack }, '[instrumentation] uncaughtException');
    if (typeof process.exit === 'function') process.exit(1);
  });
}
