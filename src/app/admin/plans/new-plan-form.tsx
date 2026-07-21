'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function NewPlanForm() {
  const [form, setForm] = useState({ slug: '', name: '', description: '', priceCents: 0, ridesIncluded: 0, durationDays: 30, isTrial: false, sortOrder: 0 });
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/api/v1/admin/plans', form);
      toast.success('Plan created');
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  return (
    <Card>
      <CardContent className="py-4">
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <div><Label>Slug</Label><Input value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} required /></div>
          <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
          <div className="col-span-2"><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} /></div>
          <div><Label>Price (cents)</Label><Input type="number" value={form.priceCents} onChange={e => setForm({ ...form, priceCents: Number(e.target.value) })} required /></div>
          <div><Label>Rides (-1 = unlimited)</Label><Input type="number" value={form.ridesIncluded} onChange={e => setForm({ ...form, ridesIncluded: Number(e.target.value) })} required /></div>
          <div><Label>Duration (days)</Label><Input type="number" value={form.durationDays} onChange={e => setForm({ ...form, durationDays: Number(e.target.value) })} required /></div>
          <div><Label>Sort order</Label><Input type="number" value={form.sortOrder} onChange={e => setForm({ ...form, sortOrder: Number(e.target.value) })} /></div>
          <div className="col-span-2 flex items-center gap-2">
            <Checkbox id="trial" checked={form.isTrial} onCheckedChange={(v) => setForm({ ...form, isTrial: v === true })} />
            <Label htmlFor="trial">Trial plan (cannot be unlimited)</Label>
          </div>
          <div className="col-span-2"><Button type="submit" disabled={loading}>{loading ? 'Creating…' : 'Create plan'}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}
