export class AppError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) { super(message); }
}
export class BadRequestError extends AppError { constructor(m: string, d?: unknown) { super(400, 'BAD_REQUEST', m, d); } }
export class UnauthorizedError extends AppError { constructor(m = 'Unauthorized') { super(401, 'UNAUTHORIZED', m); } }
export class TwoFactorRequiredError extends AppError { constructor(m = 'Two-factor authentication code required') { super(401, 'TWO_FA_REQUIRED', m); } }
export class ForbiddenError extends AppError { constructor(m = 'Forbidden') { super(403, 'FORBIDDEN', m); } }
export class NotFoundError extends AppError { constructor(m = 'Not found') { super(404, 'NOT_FOUND', m); } }
export class ConflictError extends AppError { constructor(m: string, d?: unknown) { super(409, 'CONFLICT', m, d); } }
export class PaymentRequiredError extends AppError { constructor(m = 'Payment required') { super(402, 'PAYMENT_REQUIRED', m); } }
export class RateLimitError extends AppError {
  constructor(public readonly retryAfterSec: number) { super(429, 'RATE_LIMITED', 'Too many requests'); }
}

export function toErrorEnvelope(err: unknown, requestId: string) {
  if (err instanceof AppError) {
    return { status: err.httpStatus, body: { error: { code: err.code, message: err.message, details: err.details, requestId } } };
  }
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'Internal server error', requestId } } };
}
