'use client';
import { useRouter } from 'next/navigation';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function CreateTripForm({ shuttles, routes }: { shuttles: any[]; routes: any[] }) {
  const router = useRouter();

  const [shuttleId, setShuttleId] = useState(shuttles[0]?.id ?? '');
  const [routeId, setRouteId] = useState(routes[0]?.id ?? '');
  const [tripWindow, setTripWindow] = useState<'morning' | 'evening'>('morning');
  // Default departure = tomorrow 8am
  const defaultDate = new Date(Date.now() + 24 * 3600_000);
  defaultDate.setHours(8, 0, 0, 0);
  const [departureAt, setDepartureAt] = useState(defaultDate.toISOString().slice(0, 16));
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      // Convert local datetime to ISO
      const iso = new Date(departureAt).toISOString();
      await api.post('/api/v1/admin/trips', { shuttleId, routeId, departureAt: iso, window: tripWindow });
      toast.success('Trip scheduled');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  return (
    <Card>
      <CardContent className="py-4">
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label>Shuttle</Label>
            <Select value={shuttleId} onValueChange={setShuttleId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {shuttles.map(s => <SelectItem key={s.id} value={s.id}>{s.plate} ({s.capacity} seats)</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Route</Label>
            <Select value={routeId} onValueChange={setRouteId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {routes.map(r => <SelectItem key={r.id} value={r.id}>{r.origin} → {r.destination}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Window</Label>
            <Select value={tripWindow} onValueChange={(v) => setTripWindow(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="morning">morning</SelectItem>
                <SelectItem value="evening">evening</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Departure</Label>
            <Input type="datetime-local" value={departureAt} onChange={e => setDepartureAt(e.target.value)} required />
          </div>
          <div className="md:col-span-4">
            <Button type="submit" disabled={loading || !shuttleId || !routeId}>{loading ? 'Scheduling…' : 'Schedule trip'}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
