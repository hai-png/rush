'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { useRouter } from 'next/navigation';

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  async function signOut() {
    setLoading(true);
    try {
      await api.post('/api/v1/auth/logout');
      router.push('/');
      router.refresh();
    } catch {
      // ignore
    } finally { setLoading(false); }
  }
  return (
    <Button variant="outline" size="sm" onClick={signOut} disabled={loading}>
      {loading ? '…' : 'Sign out'}
    </Button>
  );
}
