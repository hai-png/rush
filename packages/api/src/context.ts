import type { Logger } from 'pino';
import type { Context } from 'hono';

export interface Session {
  userId: string;
  role: import('@addis/shared').UserRole;
  phone: string;
  tosVersion: string | null;
  jti: string;

  impersonatedBy: string | null;
}

export interface Variables {
  requestId: string;
  logger: Logger;
  session: Session | undefined;
}

export function getSession(c: Context<{ Variables: Variables }>): Session {
  const session = c.get('session');
  if (!session) {
    throw new Error('getSession() called on a route without requireAuth/requireRole — check middleware ordering');
  }
  return session;
}

export function getOptionalSession(c: Context<{ Variables: Variables }>): Session | undefined {
  return c.get('session');
}
