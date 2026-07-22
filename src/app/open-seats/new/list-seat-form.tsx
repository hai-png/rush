'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function ListSeatForm({ ride }: { ride: any }) {
  const [tripWindow, setTripWindow] = useState<'morning' | 'evening'>(ride.trip.window);
  const [hoursUntilExpiry, setHoursUntilExpiry] = useState(24);
  const [loading, setLoading] = useState(false);

  async function list() {
    setLoading(true);
    try {
      const expiresAt = new Date(Date.now() + hoursUntilExpiry * 3600_000).toISOString();
      await api.post('/api/v1/marketplace/seat-releases', {
        tripId: ride.tripId,
        window: tripWindow,
        expiresAt,
      });
      toast.success('Seat listed on marketplace');
      window.location.href = '/open-seats';
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Window</Label>
          <Select value={tripWindow} onValueChange={(v) => setTripWindow(v as any)}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="morning">morning</SelectItem>
              <SelectItem value="evening">evening</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Expires in</Label>
          <Select value={String(hoursUntilExpiry)} onValueChange={(v) => setHoursUntilExpiry(Number(v))}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 hour</SelectItem>
              <SelectItem value="6">6 hours</SelectItem>
              <SelectItem value="24">24 hours</SelectItem>
              <SelectItem value="48">2 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button size="sm" onClick={list} disabled={loading}>{loading ? 'Listing…' : 'List this seat'}</Button>
    </div>
  );
}
