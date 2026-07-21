'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

type Sub = { id: string; name: string; ridesIncluded: number; ridesUsed: number };

export function BookRideButton({ tripId, subs, seatsLeft }: { tripId: string; subs: Sub[]; seatsLeft: number }) {
  const [open, setOpen] = useState(false);
  const [subId, setSubId] = useState(subs[0]?.id ?? '');
  const [loading, setLoading] = useState(false);

  async function book() {
    if (!subId) {
      toast.error('You need an active subscription to book a ride');
      return;
    }
    setLoading(true);
    try {
      await api.post('/api/v1/rides', { tripId, subscriptionId: subId });
      toast.success('Ride booked');
      setOpen(false);
      window.location.href = '/dashboard/rider';
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  if (seatsLeft <= 0) {
    return <Button size="sm" variant="outline" disabled>Full</Button>;
  }

  if (subs.length === 0) {
    return (
      <Dialog>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">Book</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>No active subscription</DialogTitle>
            <DialogDescription>You need an active subscription to book a ride.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button asChild><a href="/plans">Browse plans</a></Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Book ride</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Book this ride</DialogTitle>
          <DialogDescription>Pick which subscription to use. One ride credit will be consumed.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Select value={subId} onValueChange={setSubId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {subs.map(s => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} — {s.ridesIncluded === -1 ? 'unlimited' : `${s.ridesUsed}/${s.ridesIncluded} used`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={book} disabled={loading || !subId}>{loading ? 'Booking…' : 'Confirm booking'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
