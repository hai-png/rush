'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function MarkRideStatus({ rideId, action }: { rideId: string; action: 'boarded' | 'completed' | 'no_show' }) {
  const [loading, setLoading] = useState(false);
  async function mark() {
    setLoading(true);
    try {
      await api.patch(`/api/v1/rides/${rideId}`, { status: action });
      toast.success(`Marked as ${action.replace('_', ' ')}`);
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }
  return <Button size="sm" variant="outline" onClick={mark} disabled={loading}>{loading ? '…' : action.replace('_', ' ')}</Button>;
}
