'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';
import { Plus } from 'lucide-react';

const DAYS = [
  { id: 'mon', label: 'Mon' },
  { id: 'tue', label: 'Tue' },
  { id: 'wed', label: 'Wed' },
  { id: 'thu', label: 'Thu' },
  { id: 'fri', label: 'Fri' },
  { id: 'sat', label: 'Sat' },
  { id: 'sun', label: 'Sun' },
];

export function CreateAssignmentButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [routes, setRoutes] = useState<any[]>([]);
  const [contractors, setContractors] = useState<any[]>([]);
  const [shuttles, setShuttles] = useState<any[]>([]);

  const [routeId, setRouteId] = useState('');
  const [contractorId, setContractorId] = useState('');
  const [shuttleId, setShuttleId] = useState('');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [days, setDays] = useState<string[]>(['mon', 'tue', 'wed', 'thu', 'fri']);
  const [windows, setWindows] = useState<string[]>(['morning']);

  useEffect(() => {
    if (open) {
      api.get('/api/v1/routes').then(r => setRoutes(r)).catch(() => {});
      api.get('/api/v1/admin/contractors').then(r => setContractors(r)).catch(() => {});
      api.get('/api/v1/admin/shuttles').then(r => setShuttles(r)).catch(() => {});
    }
  }, [open]);

  // Filter shuttles to those owned by the selected contractor.
  const contractorShuttles = shuttles.filter((s: any) => s.contractorId === contractorId);

  async function submit() {
    if (!routeId || !contractorId || !shuttleId || days.length === 0 || windows.length === 0) {
      toast.error('Fill in all fields');
      return;
    }
    setLoading(true);
    try {
      const monthStart = new Date(month + '-01T00:00:00.000Z').toISOString();
      await api.post('/api/v1/admin/assignments', {
        routeId, contractorId, shuttleId,
        monthStart,
        schedulePattern: { days, windows },
      });
      toast.success('Assignment created — trips generated');
      setOpen(false);
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  function toggleDay(day: string) {
    setDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  }

  function toggleWindow(window: string) {
    setWindows(prev => prev.includes(window) ? prev.filter(w => w !== window) : [...prev, window]);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New Assignment</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create route assignment</DialogTitle>
          <DialogDescription>Assign a route to a contractor for a month. Daily trips are auto-generated from the schedule.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto">
          <div>
            <Label>Route</Label>
            <Select value={routeId} onValueChange={setRouteId}>
              <SelectTrigger><SelectValue placeholder="Select route" /></SelectTrigger>
              <SelectContent>
                {routes.map(r => <SelectItem key={r.id} value={r.id}>{r.origin} → {r.destination}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Contractor</Label>
            <Select value={contractorId} onValueChange={(v) => { setContractorId(v); setShuttleId(''); }}>
              <SelectTrigger><SelectValue placeholder="Select contractor" /></SelectTrigger>
              <SelectContent>
                {contractors.map(c => <SelectItem key={c.userId} value={c.userId}>{c.user?.name ?? 'Unknown'} ({c.licenseNumber})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Shuttle</Label>
            <Select value={shuttleId} onValueChange={setShuttleId} disabled={!contractorId}>
              <SelectTrigger><SelectValue placeholder={contractorId ? 'Select shuttle' : 'Select contractor first'} /></SelectTrigger>
              <SelectContent>
                {contractorShuttles.map(s => <SelectItem key={s.id} value={s.id}>{s.plate} ({s.capacity} seats)</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Month</Label>
            <Input type="month" value={month} onChange={e => setMonth(e.target.value)} />
          </div>
          <div>
            <Label>Days</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {DAYS.map(d => (
                <div key={d.id} className="flex items-center gap-1">
                  <Checkbox id={`day-${d.id}`} checked={days.includes(d.id)} onCheckedChange={() => toggleDay(d.id)} />
                  <Label htmlFor={`day-${d.id}`} className="text-sm cursor-pointer">{d.label}</Label>
                </div>
              ))}
            </div>
          </div>
          <div>
            <Label>Windows</Label>
            <div className="flex gap-4 mt-1">
              <div className="flex items-center gap-1">
                <Checkbox id="win-morning" checked={windows.includes('morning')} onCheckedChange={() => toggleWindow('morning')} />
                <Label htmlFor="win-morning" className="text-sm cursor-pointer">Morning (7:30 AM)</Label>
              </div>
              <div className="flex items-center gap-1">
                <Checkbox id="win-evening" checked={windows.includes('evening')} onCheckedChange={() => toggleWindow('evening')} />
                <Label htmlFor="win-evening" className="text-sm cursor-pointer">Evening (5:30 PM)</Label>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={loading}>{loading ? 'Creating…' : 'Create assignment'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
