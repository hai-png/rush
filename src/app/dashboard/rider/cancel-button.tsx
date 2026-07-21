'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function CancelSubscriptionButton({ id }: { id: string }) {
  const [loading, setLoading] = useState(false);
  async function cancel() {
    if (!confirm('Cancel this subscription? It cannot be undone.')) return;
    setLoading(true);
    try {
      await api.post(`/api/v1/subscriptions/${id}/cancel`);
      toast.success('Subscription cancelled');
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }
  return (
    <button type="button" onClick={cancel} disabled={loading} className="text-xs text-red-600 hover:underline disabled:opacity-50">
      {loading ? 'Cancelling…' : 'Cancel subscription'}
    </button>
  );
}
