'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function NewShuttleForm() {
  const [form, setForm] = useState({ contractorId: '', plate: '', model: '', vehicleType: 'coaster' as 'coaster' | 'minibus' | 'van' | 'sedan', capacity: 30, year: 2024 });
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/api/v1/admin/shuttles', form);
      toast.success('Shuttle created');
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  return (
    <Card>
      <CardContent className="py-4">
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <div><Label>Contractor user ID</Label><Input value={form.contractorId} onChange={e => setForm({ ...form, contractorId: e.target.value })} required placeholder="(platform admin: paste user ID)" /></div>
          <div><Label>Plate</Label><Input value={form.plate} onChange={e => setForm({ ...form, plate: e.target.value })} required /></div>
          <div><Label>Model</Label><Input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} required /></div>
          <div>
            <Label>Vehicle type</Label>
            <Select value={form.vehicleType} onValueChange={v => setForm({ ...form, vehicleType: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['coaster', 'minibus', 'van', 'sedan'].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Capacity</Label><Input type="number" value={form.capacity} onChange={e => setForm({ ...form, capacity: Number(e.target.value) })} required min={1} max={100} /></div>
          <div><Label>Year</Label><Input type="number" value={form.year} onChange={e => setForm({ ...form, year: Number(e.target.value) })} required /></div>
          <div className="col-span-2"><Button type="submit" disabled={loading}>{loading ? 'Creating…' : 'Create shuttle'}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}
