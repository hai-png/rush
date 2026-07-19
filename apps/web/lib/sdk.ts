'use client';
import { createAddisRideClient } from '@addis/sdk';
import { useSession } from 'next-auth/data';
import { useMemo } from 'react';

export function useApiClient() {
  const { data: session } = useSession();
  // Memoize so we don't recreate the client on every render — the previous
  // implementation called createAddisRideClient inline, allocating a fresh
  // client (and its middleware chain) on every render.
  return useMemo(() => createAddisRideClient({
    baseUrl: process.env.NEXT_PUBLIC_APP_URL ?? '',
    getToken: () => (session as any)?.accessToken,
  }), [session]);
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
