import type { Logger } from 'pino';

/**
 * Session shape populated by authMiddleware when a valid bearer/cookie token is present.
 * Routes that require authentication call `requireAuth` or `requireRole(...)`; routes
 * that conditionally use the session read `c.get('session')` directly (which may be
 * undefined for anonymous callers).
 *
 * `jti` is the JWT ID — the primary key of the row in the `sessions` table that this
 * token mints. Used by logout (DELETE /auth/sessions/:id) and by the idempotency
 * middleware to scope stored keys per-user.
 *
 * `tosVersion` is the user's currently-accepted Terms-of-Service version. The tos-gate
 * middleware compares this against CURRENT_TOS_VERSION and 409s if they diverge.
 */
export interface Session {
  userId: string;
  role: import('@addis/shared').UserRole;
  phone: string;
  tosVersion: string | null;
  jti: string;
}

/**
 * Per-request context variables populated by the middleware stack:
 *   - requestContext      → requestId, logger
 *   - authMiddleware      → session (may be undefined for anonymous callers)
 *
 * Declared as a Hono Variables binding so `c.get('session')` is typed as
 * `Session | undefined` instead of `unknown` — eliminates ~150 tsc TS2571 errors
 * across every route file.
 */
export interface Variables {
  requestId: string;
  logger: Logger;
  session: Session | undefined;
}
