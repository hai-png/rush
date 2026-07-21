'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function CancelReleaseButton({ id }: { id: string }) {
  const [loading, setLoading] = useState(false);
  async function cancel() {
    if (!confirm('Cancel this seat release? The seat will no longer be available on the marketplace.')) return;
    setLoading(true);
    try {
      await api.post(`/api/v1/marketplace/seat-releases/${id}/cancel`);
      toast.success('Listing cancelled');
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }
  return <Button size="sm" variant="outline" onClick={cancel} disabled={loading}>{loading ? 'Cancelling…' : 'Cancel listing'}</Button>;
}
