'use client';
import { createAddisRideClient } from '@addis/sdk';
import { useSession, signOut } from 'next-auth/react';
import { useMemo } from 'react';
import type { QueryClient } from '@tanstack/react-query';

// Client-only SDK helpers. The server-side `getServerApiClient` lives in
// lib/server-api.ts so that the postgres dependency (via auth ->
// identityService -> @addis/db) is never pulled into the client bundle.

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
  // FE-002: use empty baseUrl (same-origin) in the browser — the previous
  // code referenced NEXT_PUBLIC_APP_URL which is never set, making the env
  // var name misleading. Empty baseUrl makes openapi-fetch use relative
  // paths, which is correct for browser-to-same-origin API calls.
  return useMemo(() => createAddisRideClient({
    baseUrl: '',
    getToken: () => token,
    onUnauthorized: () => handleUnauthorized(),
  }), [token]);
}
