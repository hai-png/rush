'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function RevokeSessionButton({ id }: { id: string }) {
  const [loading, setLoading] = useState(false);
  async function revoke() {
    setLoading(true);
    try {
      await api.del(`/api/v1/auth/sessions/${id}`);
      toast.success('Session revoked');
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }
  return <Button size="sm" variant="outline" onClick={revoke} disabled={loading}>{loading ? '…' : 'Revoke'}</Button>;
}
