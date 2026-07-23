'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

// FE-05: replace native confirm() with a styled shadcn/ui Dialog.
export function DeleteButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  async function del() {
    setLoading(true);
    try {
      await api.post('/api/v1/account/delete');
      toast.success('Account scheduled for deletion');
      setOpen(false);
      router.push('/');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" disabled={loading} className="w-full">{loading ? 'Deleting…' : 'Delete my account'}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete account?</DialogTitle>
          <DialogDescription>
            This action cannot be undone. Your account will be deactivated immediately and your data
            permanently removed after a 30-day grace period.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>Cancel</Button>
          <Button variant="destructive" onClick={del} disabled={loading}>{loading ? 'Deleting…' : 'Delete my account'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
