'use client';
import { useRouter } from 'next/navigation';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function AssignmentActions({ id }: { id: string }) {
  const router = useRouter();

  const [loading, setLoading] = useState<null | 'accept' | 'reject'>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');

  async function accept() {
    setLoading('accept');
    try {
      await api.post(`/api/v1/assignments/${id}/accept`);
      toast.success('Assignment accepted — now active');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(null); }
  }

  async function reject() {
    setLoading('reject');
    try {
      await api.post(`/api/v1/assignments/${id}/reject`, { reason });
      toast.success('Assignment rejected');
      setRejectOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(null); }
  }

  return (
    <div className="flex gap-2">
      <Button size="sm" onClick={accept} disabled={loading !== null}>{loading === 'accept' ? '…' : 'Accept'}</Button>
      <Button size="sm" variant="outline" onClick={() => setRejectOpen(true)} disabled={loading !== null}>Reject</Button>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject assignment</DialogTitle>
            <DialogDescription>Provide a reason for rejecting this route assignment.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label>Reason</Label>
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Shuttle in maintenance" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={reject} disabled={loading !== null || !reason}>{loading === 'reject' ? '…' : 'Reject'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
