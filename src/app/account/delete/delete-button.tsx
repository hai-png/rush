'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function DeleteButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  async function del() {
    if (!confirm('Confirm account deletion? This cannot be undone.')) return;
    setLoading(true);
    try {
      await api.post('/api/v1/account/delete');
      toast.success('Account scheduled for deletion');
      router.push('/');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }
  return <Button variant="destructive" onClick={del} disabled={loading} className="w-full">{loading ? 'Deleting…' : 'Delete my account'}</Button>;
}
