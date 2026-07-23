'use client';
import { useRouter } from 'next/navigation';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

// FE-05 / FE-035: replace native confirm() with a styled shadcn/ui Dialog so
// the UX matches the rest of the design system and the button uses the
// shared <Button> component (was a raw <button>).
export function CancelSubscriptionButton({ id }: { id: string }) {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  async function cancel() {
    setLoading(true);
    try {
      await api.post(`/api/v1/subscriptions/${id}/cancel`);
      toast.success('Subscription cancelled');
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="link" className="text-xs text-red-600 hover:underline p-0 h-auto" disabled={loading}>
          {loading ? 'Cancelling…' : 'Cancel subscription'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel subscription?</DialogTitle>
          <DialogDescription>This action cannot be undone. Any remaining rides will be forfeited.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>Keep subscription</Button>
          <Button variant="destructive" onClick={cancel} disabled={loading}>{loading ? 'Cancelling…' : 'Cancel subscription'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
