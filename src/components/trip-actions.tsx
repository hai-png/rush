'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function TripActions({ tripId, status }: { tripId: string; status: string }) {
  const [loading, setLoading] = useState<'board' | 'complete' | null>(null);

  async function act(action: 'board' | 'complete') {
    setLoading(action);
    try {
      await api.post(`/api/v1/trips/${tripId}/${action}`);
      toast.success(`${action === 'board' ? 'Boarded' : 'Completed'}`);
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(null); }
  }

  if (status === 'scheduled') {
    return <Button size="sm" variant="outline" onClick={() => act('board')} disabled={loading !== null}>{loading === 'board' ? '…' : 'Board'}</Button>;
  }
  if (status === 'in_transit') {
    return <Button size="sm" variant="outline" onClick={() => act('complete')} disabled={loading !== null}>{loading === 'complete' ? '…' : 'Complete'}</Button>;
  }
  return null;
}
