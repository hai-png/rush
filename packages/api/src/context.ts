import type { Logger } from 'pino';
import type { Context } from 'hono';

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

/**
 * Type-safe session accessor. Routes protected by `requireAuth` / `requireRole(...)`
 * are guaranteed to have a session, but TypeScript still sees `c.get('session')` as
 * `Session | undefined` and flags every `.userId` / `.role` access with TS2532.
 *
 * Calling `getSession(c)` instead of `c.get('session')` narrows the type to `Session`
 * (throwing a runtime error if the session is somehow missing — which would be a bug
 * in the middleware ordering, not a user error). This eliminates ~120 TS2532 errors
 * across every protected route handler.
 */
export function getSession(c: Context<{ Variables: Variables }>): Session {
  const session = c.get('session');
  if (!session) {
    throw new Error('getSession() called on a route without requireAuth/requireRole — check middleware ordering');
  }
  return session;
}

/**
 * Type-safe optional session accessor. For routes that conditionally use the session
 * (e.g. the auth middleware itself, or public routes that personalize if logged in),
 * returns `Session | undefined` without throwing.
 */
export function getOptionalSession(c: Context<{ Variables: Variables }>): Session | undefined {
  return c.get('session');
}
