'use client';
import { useRouter } from 'next/navigation';

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
  const router = useRouter();

  const [form, setForm] = useState({ slug: '', name: '', description: '', priceCents: 0, ridesIncluded: 0, durationDays: 30, isTrial: false, sortOrder: 0 });
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/api/v1/admin/plans', form);
      toast.success('Plan created');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  return (
    <Card>
      <CardContent className="py-4">
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="plan-slug">Slug</Label><Input id="plan-slug" value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} required /></div>
          <div><Label htmlFor="plan-name">Name</Label><Input id="plan-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
          <div className="col-span-2"><Label htmlFor="plan-description">Description</Label><Textarea id="plan-description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} /></div>
          <div><Label htmlFor="plan-price">Price (cents)</Label><Input id="plan-price" type="number" value={form.priceCents} onChange={e => setForm({ ...form, priceCents: Number(e.target.value) })} required /></div>
          <div><Label htmlFor="plan-rides">Rides (-1 = unlimited)</Label><Input id="plan-rides" type="number" value={form.ridesIncluded} onChange={e => setForm({ ...form, ridesIncluded: Number(e.target.value) })} required /></div>
          <div><Label htmlFor="plan-duration">Duration (days)</Label><Input id="plan-duration" type="number" value={form.durationDays} onChange={e => setForm({ ...form, durationDays: Number(e.target.value) })} required /></div>
          <div><Label htmlFor="plan-sort">Sort order</Label><Input id="plan-sort" type="number" value={form.sortOrder} onChange={e => setForm({ ...form, sortOrder: Number(e.target.value) })} /></div>
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
