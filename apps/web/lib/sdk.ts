'use client';
import { createAddisRideClient } from '@addis/sdk';
import { useSession } from 'next-auth/react';

/**
 * Client-side API client. Uses an empty-string baseUrl so fetches go to relative URLs
 * (the Next.js dev server / Vercel edge handles routing). This works in the browser
 * because the API and web app share an origin via the Caddy reverse proxy in infra/.
 *
 * The previous version read `process.env.NEXT_PUBLIC_APP_URL`, which is NOT in the env
 * schema and was never set anywhere — resulting in the same empty-string behaviour but
 * only by accident. Make the intent explicit.
 */
export function useApiClient() {
  const { data: session } = useSession();
  return createAddisRideClient({
    baseUrl: '',
    getToken: () => (session as any)?.accessToken,
  });
}

/** Server Component variant — reads cookie directly, no client-side session hook. */
export async function getServerApiClient() {
  const { cookies } = await import('next/headers');
  const token = (await cookies()).get('__Secure-session-token')?.value;
  // Server-side fetches must use an absolute URL because there's no browser origin to
  // resolve a relative URL against. NEXTAUTH_URL is the canonical web-app origin.
  return createAddisRideClient({ baseUrl: process.env.NEXTAUTH_URL!, getToken: () => token });
}
