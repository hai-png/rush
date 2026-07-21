// Server-side session check for page-level route guards.
// Reads the session cookie, verifies it, returns the session or null.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession, type Session } from '@/lib/auth';
import { SESSION_COOKIE } from '@/lib/api';

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await verifySession(token);
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}

export async function requireRole(...roles: string[]): Promise<Session> {
  const s = await requireSession();
  if (!roles.includes(s.role)) redirect('/');
  return s;
}
