import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { db } from '@/lib/db';
import { loadEnv } from '@/lib/env';
import { UnauthorizedError, ForbiddenError } from '@/lib/errors';
import { TWO_FA_REQUIRED_ROLES } from '@/lib/env';
import { createId } from '@/lib/id';

const SESSION_TTL_SEC = 30 * 24 * 3600; // 30 days

function secretKey(): Uint8Array {
  return new TextEncoder().encode(loadEnv().AUTH_SECRET);
}

export type SessionUser = {
  id: string;
  phone: string;
  role: string;
  tosVersion: string | null;
  jti: string;
};

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function issueSession(user: { id: string; phone: string; role: string; tosVersion: string | null; tokenVersion: number }, opts: { userAgent?: string; ipAddress?: string } = {}): Promise<{ token: string; expiresAt: Date; jti: string }> {
  const jti = createId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SEC * 1000);

  await db.session.create({
    data: {
      id: createId(),
      userId: user.id,
      jti,
      userAgent: opts.userAgent,
      ipAddress: opts.ipAddress,
      expiresAt,
    },
  });

  const token = await new SignJWT({
    sub: user.id,
    phone: user.phone,
    role: user.role,
    tos: user.tosVersion,
    tv: user.tokenVersion,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(secretKey());

  return { token, expiresAt, jti };
}

export async function verifySession(token: string): Promise<SessionUser> {
  let payload: JWTPayload;
  try {
    const { payload: p } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    payload = p;
  } catch {
    throw new UnauthorizedError('Invalid or expired session');
  }

  const userId = payload.sub!;
  const jti = payload.jti!;
  const tv = (payload.tv as number) ?? 0;

  const session = await db.session.findUnique({ where: { jti } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw new UnauthorizedError('Session revoked or expired');
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, phone: true, role: true, tosVersion: true, tokenVersion: true, isActive: true, deletedAt: true },
  });
  if (!user || !user.isActive || user.deletedAt) {
    throw new UnauthorizedError('Account not available');
  }
  if (user.tokenVersion !== tv) {
    throw new UnauthorizedError('Session invalidated — please log in again');
  }

  // Update lastSeenAt so admins can spot stale-but-unexpired sessions.
  // Best-effort — never fail the request if this write fails (e.g. under heavy
  // load or single-writer contention).
  db.session.update({ where: { jti }, data: { lastSeenAt: new Date() } }).catch(() => {});

  return {
    id: user.id,
    phone: user.phone,
    role: user.role,
    tosVersion: user.tosVersion,
    jti,
  };
}

export async function revokeSession(jti: string): Promise<void> {
  await db.session.updateMany({
    where: { jti, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function assertTwoFactorEnabled(userId: string, role: string): Promise<void> {
  if (!TWO_FA_REQUIRED_ROLES.includes(role as any)) return;
  const u = await db.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true, phoneVerified: true } });
  if (!u) throw new UnauthorizedError();
  if (!u.phoneVerified) throw new ForbiddenError('Phone verification required for this role. Verify your phone first.');
  if (!u.twoFactorEnabled) throw new ForbiddenError('Two-factor authentication required for this role. Enable it at /api/v1/auth/2fa/setup.');
}
