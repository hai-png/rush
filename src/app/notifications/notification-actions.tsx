'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function NotificationActions({ mode, id }: { mode: 'mark-one' | 'mark-all'; id?: string }) {
  const [loading, setLoading] = useState(false);

  async function markRead() {
    setLoading(true);
    try {
      if (mode === 'mark-one' && id) {
        await api.post(`/api/v1/notifications/${id}/read`);
      } else {
        await api.post('/api/v1/notifications/read-all');
      }
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  return (
    <Button size="sm" variant="outline" onClick={markRead} disabled={loading}>
      {loading ? '…' : mode === 'mark-one' ? 'Mark read' : 'Mark all read'}
    </Button>
  );
}
