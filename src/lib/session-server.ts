import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession, type SessionUser } from '@/lib/auth';
import { SESSION_COOKIE } from '@/lib/api';
import { CURRENT_TOS_VERSION } from '@/lib/env';

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
  if (s.tosVersion !== CURRENT_TOS_VERSION) {
    const path = typeof window !== 'undefined' ? window.location.pathname : '';
    redirect(`/tos/accept?next=${encodeURIComponent(path)}`);
  }
  return s;
}

export async function requireRole(...roles: string[]): Promise<SessionUser> {
  const s = await requireSession();
  if (!roles.includes(s.role)) redirect('/');
  return s;
}

