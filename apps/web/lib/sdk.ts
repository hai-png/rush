'use client';
import { createAddisRideClient } from '@addis/sdk';
import { useSession } from 'next-auth/react';

export function useApiClient() {
  const { data: session } = useSession();
  return createAddisRideClient({
    baseUrl: process.env.NEXT_PUBLIC_APP_URL ?? '',
    getToken: () => (session as any)?.accessToken,
  });
}

/** Server Component variant — reads cookie directly, no client-side session hook. */
export async function getServerApiClient() {
  const { cookies } = await import('next/headers');
  const token = (await cookies()).get('__Secure-session-token')?.value;
  return createAddisRideClient({ baseUrl: process.env.NEXTAUTH_URL!, getToken: () => token });
}
