'use client';
import { createAddisRideClient } from '@addis/sdk';
import { useSession } from 'next-auth/data';
import { useMemo } from 'react';
import { signOut } from 'next-auth/react';
import type { QueryClient } from '@tanstack/react-query';

let queryClientRef: QueryClient | null = null;
export function setQueryClientForSdk(c: QueryClient | null) { queryClientRef = c; }

const DEBOUNCE_MS = 5_000;
let lastSignOutAt = 0;
function handleUnauthorized() {
  const now = Date.now();
  if (now - lastSignOutAt < DEBOUNCE_MS) return;
  lastSignOutAt = now;
  try { queryClientRef?.clear(); } catch {  }

  signOut({ callbackUrl: '/login?reason=session_expired' }).catch(() => {

    if (typeof window !== 'undefined') window.location.href = '/login?reason=session_expired';
  });
}

export function useApiClient() {
  const { data: session } = useSession();

  const token = (session as any)?.accessToken;
  return useMemo(() => createAddisRideClient({
    baseUrl: process.env.NEXT_PUBLIC_APP_URL ?? '',
    getToken: () => token,
    onUnauthorized: () => handleUnauthorized(),
  }), [token]);
}

export async function getServerApiClient() {
  const { auth } = await import('../../auth');
  const session = await auth();
  if (!session) {
    throw new Error('Not authenticated — server component called getServerApiClient without a session');
  }
  const baseUrl = process.env.NEXTAUTH_URL;
  if (!baseUrl) throw new Error('NEXTAUTH_URL is not set');
  return createAddisRideClient({ baseUrl, getToken: () => (session as any).accessToken });
}
