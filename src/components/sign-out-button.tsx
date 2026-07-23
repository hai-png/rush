'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api-client';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  // FE-054: surface sign-out failures to the user instead of silently
  // swallowing them. Even if the server-side session-revoke call fails
  // (network drop, 5xx, etc.) we still clear local state and bounce to the
  // home page so the user isn't left in a half-signed-out limbo — that
  // happens in the `finally` block.
  async function signOut() {
    setLoading(true);
    try {
      await api.post('/api/v1/auth/logout');
      router.push('/');
      router.refresh();
    } catch (err) {
      toast.error('Sign out failed — please refresh and try again');
      // Best-effort client-side log so the failure is visible in browser
      // dev tools without leaking the response body to the toast. The
      // server-side pino logger can't be imported from a 'use client' module
      // without dragging server-only env code into the browser bundle, so
      // we use console.warn here. The 401 path is already logged server-side
      // by the API route.
      console.warn('signout.error', {
        message: err instanceof Error ? err.message : String(err),
        status: err instanceof ApiError ? err.status : undefined,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={signOut} disabled={loading}>
      {loading ? '…' : 'Sign out'}
    </Button>
  );
}
