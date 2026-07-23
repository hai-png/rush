'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';
import { Plus } from 'lucide-react';

export function RegisterShuttleForm() {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ plate: '', model: '', vehicleType: 'coaster', capacity: 30, year: 2024 });

  async function submit() {
    setLoading(true);
    try {
      await api.post('/api/v1/admin/shuttles', { ...form });
      toast.success('Shuttle registered');
      setOpen(false); router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> Register shuttle</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Register a shuttle</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label htmlFor="shuttle-plate">Plate number</Label><Input id="shuttle-plate" value={form.plate} onChange={e => setForm({ ...form, plate: e.target.value })} placeholder="AA-12345" /></div>
          <div><Label htmlFor="shuttle-model">Model</Label><Input id="shuttle-model" value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="Toyota Coaster" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="shuttle-type">Type</Label>
              <Select value={form.vehicleType} onValueChange={v => setForm({ ...form, vehicleType: v })}>
                <SelectTrigger id="shuttle-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['coaster', 'minibus', 'van', 'sedan'].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label htmlFor="shuttle-capacity">Capacity</Label><Input id="shuttle-capacity" type="number" min={1} max={100} value={form.capacity} onChange={e => setForm({ ...form, capacity: Number(e.target.value) })} /></div>
          </div>
          <div><Label htmlFor="shuttle-year">Year</Label><Input id="shuttle-year" type="number" min={1990} max={new Date().getFullYear() + 1} value={form.year} onChange={e => setForm({ ...form, year: Number(e.target.value) })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={loading || !form.plate || !form.model}>{loading ? 'Registering…' : 'Register'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
