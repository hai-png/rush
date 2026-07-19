'use client';
import { createAddisRideClient } from '@addis/sdk';
import { useSession } from 'next-auth/data';
import { useMemo } from 'react';

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
