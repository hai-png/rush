'use client';
import { createAddisRideClient } from '@addis/sdk';
import { useSession } from 'next-auth/data';
import { useMemo } from 'react';
import { signOut } from 'next-auth/react';
import type { QueryClient } from '@tanstack/react-query';

// FIX (FE-008): the SDK now exposes an optional `onUnauthorized` callback
// fired on 401 (excluding TWO_FA_REQUIRED, which is a flow-control signal
// during login — not a session-expiry event). The web app wires it to:
//   1. `signOut({ callbackUrl: '/login?reason=session_expired' })` —
//      destroys the NextAuth session and redirects to login.
//   2. React Query cache clear — prevents stale authenticated data from
//      lingering after the session is destroyed.
//   3. Debounce (5s window) — a request storm (e.g., 10 parallel queries
//      all 401'ing at once) triggers only ONE signOut, not 10 redirects.
//
// `queryClientRef` is populated by Providers via `setQueryClientForSdk`
// so the callback (which lives outside React's tree) can access the
// active QueryClient.
let queryClientRef: QueryClient | null = null;
export function setQueryClientForSdk(c: QueryClient | null) { queryClientRef = c; }

const DEBOUNCE_MS = 5_000;
let lastSignOutAt = 0;
function handleUnauthorized() {
  const now = Date.now();
  if (now - lastSignOutAt < DEBOUNCE_MS) return; // debounce — already signing out
  lastSignOutAt = now;
  try { queryClientRef?.clear(); } catch { /* noop */ }
  // `signOut` redirects the browser to callbackUrl; no need to throw.
  signOut({ callbackUrl: '/login?reason=session_expired' }).catch(() => {
    // If signOut itself fails (network race), force a hard navigation so
    // the user isn't stranded on a page with a dead session.
    if (typeof window !== 'undefined') window.location.href = '/login?reason=session_expired';
  });
}

export function useApiClient() {
  const { data: session } = useSession();
  // FIX (WEB-013): The previous memo depended on the whole `session` object,
  // but next-auth's useSession() returns a new `data` reference on every
  // session refresh (every ~5 min). The memo never hit, so the client was
  // recreated on every refresh — and every component using `useApiClient`
  // then passed a new `client` to useQuery's queryFn, triggering refetch
  // storms across the tree. Memoize on the actual primitive that matters
  // — the access token string — so the client only changes when the token
  // actually changes.
  const token = (session as any)?.accessToken;
  return useMemo(() => createAddisRideClient({
    baseUrl: process.env.NEXT_PUBLIC_APP_URL ?? '',
    getToken: () => token,
    onUnauthorized: () => handleUnauthorized(),
  }), [token]);
}

/**
 * Server Component variant.
 *
 * CRITICAL FIX: the previous implementation read the raw `__Secure-session-token`
 * cookie value and passed it as a Bearer token to the API. But that cookie
 * contains the NextAuth JWT (the session envelope), NOT the API access
 * token. The API's auth middleware expects `Authorization: Bearer <api-access-token>`
 * (a separate token issued by identityService.login and embedded inside the
 * NextAuth session via the jwt/session callbacks). Passing the NextAuth JWT
 * as a bearer token always 401'd — every server-component fetch (landing
 * page, admin dashboard, help center) was broken.
 *
 * Now we call NextAuth's `auth()` to get the decoded session, which
 * includes the `accessToken` field populated by the jwt callback in auth.ts.
 *
 * FE-008: server-side clients do NOT wire `onUnauthorized` — there's no
 * browser session to sign out of, and server-side 401s are handled by the
 * caller (typically a redirect to /login via middleware).
 */
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
