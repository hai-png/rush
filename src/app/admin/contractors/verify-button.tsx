'use client';
import { useRouter } from 'next/navigation';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function VerifyButton({ id }: { id: string }) {
  const router = useRouter();

  const [loading, setLoading] = useState<null | 'verified' | 'rejected'>(null);
  async function verify(status: 'verified' | 'rejected') {
    setLoading(status);
    try {
      await api.post(`/api/v1/admin/contractors/${id}/verify`, { status });
      toast.success(`Contractor ${status}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(null); }
  }
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="outline" onClick={() => verify('verified')} disabled={loading !== null}>{loading === 'verified' ? '…' : 'Verify'}</Button>
      <Button size="sm" variant="outline" onClick={() => verify('rejected')} disabled={loading !== null}>{loading === 'rejected' ? '…' : 'Reject'}</Button>
    </div>
  );
}
