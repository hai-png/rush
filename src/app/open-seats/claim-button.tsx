'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function ClaimButton({ releaseId, fare }: { releaseId: string; fare: number }) {
  const router = useRouter();
  const [method, setMethod] = useState<'telebirr' | 'cbe'>('telebirr');
  const [loading, setLoading] = useState(false);

  async function claim() {
    setLoading(true);
    try {
      const res = await api.post<{ checkout: { status: string; checkoutUrl?: string; instructions?: string } }>(`/api/v1/marketplace/seat-releases/${releaseId}/claim`, { paymentMethod: method });
      if (res.checkout.status === 'checkout' && res.checkout.checkoutUrl) {
        router.push(res.checkout.checkoutUrl);
      } else if (res.checkout.status === 'manual') {
        toast.message('CBE instructions', { description: res.checkout.instructions });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  return (
    <div className="mt-3 flex gap-2">
      <Select value={method} onValueChange={v => setMethod(v as any)}>
        <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="telebirr">Telebirr</SelectItem>
          <SelectItem value="cbe">CBE</SelectItem>
        </SelectContent>
      </Select>
      <Button onClick={claim} disabled={loading}>{loading ? '…' : 'Claim'}</Button>
    </div>
  );
}
