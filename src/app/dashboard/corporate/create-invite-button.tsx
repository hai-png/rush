'use client';
import { useRouter } from 'next/navigation';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function CreateInviteButton() {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [maxUses, setMaxUses] = useState(50);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    try {
      await api.post('/api/v1/corporate/invites', { note, maxUses });
      toast.success('Invite created');
      setOpen(false);
      setNote('');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">New invite</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create invite code</DialogTitle>
          <DialogDescription>Share the code with employees you want to invite.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="invite-note">Note (optional)</Label>
            <Input id="invite-note" value={note} onChange={e => setNote(e.target.value)} placeholder="For Engineering team" maxLength={200} />
          </div>
          <div>
            <Label htmlFor="invite-max-uses">Max uses</Label>
            <Input id="invite-max-uses" type="number" min={1} max={1000} value={maxUses} onChange={e => setMaxUses(Number(e.target.value))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={loading}>{loading ? 'Creating…' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
