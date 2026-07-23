'use client';
import { useRouter } from 'next/navigation';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

// FE-05: replace native confirm() with a styled shadcn/ui Dialog.
export function CancelReleaseButton({ id }: { id: string }) {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  async function cancel() {
    setLoading(true);
    try {
      await api.post(`/api/v1/marketplace/seat-releases/${id}/cancel`);
      toast.success('Listing cancelled');
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={loading}>{loading ? 'Cancelling…' : 'Cancel listing'}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel seat release?</DialogTitle>
          <DialogDescription>The seat will no longer be available on the marketplace. It will be restored to your trip booking.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>Keep listing</Button>
          <Button variant="destructive" onClick={cancel} disabled={loading}>{loading ? 'Cancelling…' : 'Cancel listing'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
