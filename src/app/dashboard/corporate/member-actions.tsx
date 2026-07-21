'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function MemberActions({ id }: { id: string }) {
  const [loading, setLoading] = useState<null | 'approve' | 'reject'>(null);

  async function act(action: 'approve' | 'reject') {
    setLoading(action);
    try {
      await api.post(`/api/v1/corporate/members/${id}/${action}`);
      toast.success(action === 'approve' ? 'Member approved' : 'Member rejected');
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(null); }
  }

  return (
    <div className="flex gap-1">
      <Button size="sm" onClick={() => act('approve')} disabled={loading !== null}>{loading === 'approve' ? '…' : 'Approve'}</Button>
      <Button size="sm" variant="outline" onClick={() => act('reject')} disabled={loading !== null}>{loading === 'reject' ? '…' : 'Reject'}</Button>
    </div>
  );
}
