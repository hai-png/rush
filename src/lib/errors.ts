import { logger } from '@/lib/logger';

// lazy-load Sentry so the errors.ts module doesn't crash if
// @sentry/nextjs isn't installed (e.g. in the test environment).
let SentryModule: any = null;
async function getSentry(): Promise<any> {
  if (SentryModule !== null) return SentryModule;
  try {
    SentryModule = await import('@sentry/nextjs');
  } catch {
    SentryModule = false; // not installed
  }
  return SentryModule;
}
// them to { error: { code, message, requestId } }.

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', code = 'BAD_REQUEST') { super(400, code, message); }
}
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', code = 'UNAUTHORIZED') { super(401, code, message); }
}
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code = 'FORBIDDEN') { super(403, code, message); }
}
export class NotFoundError extends AppError {
  constructor(message = 'Not found', code = 'NOT_FOUND') { super(404, code, message); }
}
export class ConflictError extends AppError {
  constructor(message = 'Conflict', code = 'CONFLICT') { super(409, code, message); }
}
export class RateLimitError extends AppError {
  constructor(public readonly retryAfterSec: number, message = 'Too many requests') {
    super(429, 'RATE_LIMIT', message);
  }
}
export class TwoFactorRequiredError extends AppError {
  constructor(message = 'Two-factor authentication required') { super(423, 'TWO_FACTOR_REQUIRED', message); }
}

export function toErrorEnvelope(err: unknown, requestId: string): { status: number; body: any } {
  if (err instanceof AppError) {
    return { status: err.status, body: { error: { code: err.code, message: err.message, requestId } } };
  }
  // Zod errors
  if (err && typeof err === 'object' && 'name' in err && (err as any).name === 'ZodError') {
    return {
      status: 400,
      body: { error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: (err as any).issues, requestId } },
    };
  }
  // report unhandled (non-AppError) errors to Sentry.
  // Fire-and-forget — toErrorEnvelope is synchronous and we don't want to
  // block the error response on Sentry's network call.
  getSentry().then(sentry => {
    if (sentry) sentry.captureException(err, { tags: { requestId } });
  }).catch(() => {});
  logger.error({ err }, '[unhandled]');
  return {
    status: 500,
    body: { error: { code: 'INTERNAL', message: 'Something went wrong', requestId } },
  };
}
