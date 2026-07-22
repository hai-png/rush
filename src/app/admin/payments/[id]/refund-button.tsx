'use client';
import { useRouter } from 'next/navigation';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function RefundButton({ paymentId, maxAmount }: { paymentId: string; maxAmount: number }) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(maxAmount);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (amount <= 0 || amount > maxAmount) {
      toast.error(`Amount must be between 0 and ${maxAmount} ETB`);
      return;
    }
    if (!reason.trim()) {
      toast.error('Reason is required');
      return;
    }
    setLoading(true);
    try {
      await api.post(`/api/v1/admin/payments/${paymentId}/refund`, { amount, reason });
      toast.success('Refund scheduled');
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Issue refund</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue refund</DialogTitle>
          <DialogDescription>Refunds are processed via the original payment provider (Telebirr/CBE).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Amount (ETB)</Label>
            <Input type="number" min={0.01} max={maxAmount} step="0.01" value={amount} onChange={e => setAmount(Number(e.target.value))} />
            <p className="text-xs text-muted-foreground mt-1">Max: {maxAmount.toFixed(2)} ETB</p>
          </div>
          <div>
            <Label>Reason</Label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="Customer request / duplicate charge / service issue" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={loading}>{loading ? 'Scheduling…' : 'Schedule refund'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
