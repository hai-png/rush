// Typed error envelope — single source of truth for HTTP error responses.
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
  console.error('[unhandled]', err);
  return {
    status: 500,
    body: { error: { code: 'INTERNAL', message: 'Something went wrong', requestId } },
  };
}
