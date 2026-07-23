'use client';
import { useRouter } from 'next/navigation';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function NewRouteForm() {
  const router = useRouter();

  const [form, setForm] = useState({ origin: '', destination: '', distanceKm: 10, durationMin: 30, fareCents: 5000 });
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/api/v1/admin/routes', form);
      toast.success('Route created');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  return (
    <Card>
      <CardContent className="py-4">
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="origin">Origin</Label><Input id="origin" value={form.origin} onChange={e => setForm({ ...form, origin: e.target.value })} required /></div>
          <div><Label htmlFor="destination">Destination</Label><Input id="destination" value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} required /></div>
          <div><Label htmlFor="distanceKm">Distance (km)</Label><Input id="distanceKm" type="number" step="0.1" value={form.distanceKm} onChange={e => setForm({ ...form, distanceKm: Number(e.target.value) })} required /></div>
          <div><Label htmlFor="durationMin">Duration (min)</Label><Input id="durationMin" type="number" value={form.durationMin} onChange={e => setForm({ ...form, durationMin: Number(e.target.value) })} required /></div>
          <div><Label htmlFor="fareCents">Fare (cents)</Label><Input id="fareCents" type="number" value={form.fareCents} onChange={e => setForm({ ...form, fareCents: Number(e.target.value) })} required /></div>
          <div className="col-span-2"><Button type="submit" disabled={loading}>{loading ? 'Creating…' : 'Create route'}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}
