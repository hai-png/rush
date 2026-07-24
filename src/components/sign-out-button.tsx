'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api-client';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function signOut() {
    setLoading(true);
    try {
      await api.post('/api/v1/auth/logout');
      router.push('/');
      router.refresh();
    } catch (err) {
      toast.error('Sign out failed — please refresh and try again');
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