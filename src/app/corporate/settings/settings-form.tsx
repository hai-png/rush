'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function CorporateSettingsForm({ corp }: { corp: any }) {
  const [form, setForm] = useState({
    name: corp.name,
    contactEmail: corp.contactEmail,
    contactPhone: corp.contactPhone,
    subsidyPercent: corp.subsidyPercent,
    monthlySeatAllowance: corp.monthlySeatAllowance,
  });
  const [loading, setLoading] = useState(false);

  async function save() {
    setLoading(true);
    try {
      await api.patch('/api/v1/corporate', form);
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-3">
      <div><Label htmlFor="corp-name">Company name</Label><Input id="corp-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
      <div><Label htmlFor="corp-email">Contact email</Label><Input id="corp-email" type="email" value={form.contactEmail} onChange={e => setForm({ ...form, contactEmail: e.target.value })} /></div>
      <div><Label htmlFor="corp-phone">Contact phone</Label><Input id="corp-phone" value={form.contactPhone} onChange={e => setForm({ ...form, contactPhone: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label htmlFor="corp-subsidy">Subsidy (%)</Label><Input id="corp-subsidy" type="number" min={0} max={100} value={form.subsidyPercent} onChange={e => setForm({ ...form, subsidyPercent: Number(e.target.value) })} /></div>
        <div><Label htmlFor="corp-allowance">Monthly allowance</Label><Input id="corp-allowance" type="number" min={1} value={form.monthlySeatAllowance} onChange={e => setForm({ ...form, monthlySeatAllowance: Number(e.target.value) })} /></div>
      </div>
      <Button onClick={save} disabled={loading}>{loading ? 'Saving…' : 'Save settings'}</Button>
    </div>
  );
}
