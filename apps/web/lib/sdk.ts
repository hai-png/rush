'use client';
import { createAddisRideClient } from '@addis/sdk';
import { useSession, signOut } from 'next-auth/react';
import { useMemo } from 'react';
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
    baseUrl: '',
    getToken: () => token,
    onUnauthorized: () => handleUnauthorized(),
  }), [token]);
}
