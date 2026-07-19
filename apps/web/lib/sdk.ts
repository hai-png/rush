'use client';
import { createAddisRideClient } from '@addis/sdk';
import { useSession } from 'next-auth/react';

/**
 * Client-side API client. Uses an empty-string baseUrl so fetches go to relative URLs
 * (the Next.js dev server / Vercel edge handles routing). This works in the browser
 * because the API and web app share an origin via the Caddy reverse proxy in infra/.
 */
export function useApiClient() {
  const { data: session } = useSession();
  return createAddisRideClient({
    baseUrl: '',
    getToken: () => (session as any)?.accessToken,
  });
}

/**
 * Server Component variant. Reads the access token from the NextAuth session via
 * `auth()` — NOT from the raw `__Secure-session-token` cookie.
 *
 * The cookie is NextAuth v5's own JWE-encrypted session cookie; the API's
 * `identityService.verifySession()` expects the app-issued `jose` HS256 JWT that
 * lives inside `session.accessToken`. Sending the raw cookie as a Bearer token
 * fails `jwtVerify` → `c.get('session')` is never set → every requireRole()
 * route 401s. This was the root cause of the admin dashboard server component
 * always returning 401.
 */
export async function getServerApiClient() {
  const { auth } = await import('@/auth');
  const session = await auth();
  const token = (session as any)?.accessToken;
  // Server-side fetches must use an absolute URL because there's no browser origin
  // to resolve a relative URL against. NEXTAUTH_URL is the canonical web-app origin.
  return createAddisRideClient({ baseUrl: process.env.NEXTAUTH_URL!, getToken: () => token });
}
