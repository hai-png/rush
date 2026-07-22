import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession, type SessionUser } from '@/lib/auth';
import { SESSION_COOKIE } from '@/lib/api';

export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await verifySession(token);
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}

export async function requireRole(...roles: string[]): Promise<SessionUser> {
  const s = await requireSession();
  if (!roles.includes(s.role)) redirect('/');
  return s;
}
