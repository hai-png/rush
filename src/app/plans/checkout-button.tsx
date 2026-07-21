'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function CheckoutButton({ planId }: { planId: string }) {
  const router = useRouter();
  const [method, setMethod] = useState<'telebirr' | 'cbe'>('telebirr');
  const [loading, setLoading] = useState(false);

  async function start() {
    setLoading(true);
    try {
      const res = await api.post<{ checkout: { status: string; checkoutUrl?: string; instructions?: string }; paymentReference: string }>('/api/v1/subscriptions', { planId, paymentMethod: method });
      if (res.checkout.status === 'checkout' && res.checkout.checkoutUrl) {
        // Telebirr redirect (real or mock).
        router.push(res.checkout.checkoutUrl);
      } else if (res.checkout.status === 'manual') {
        // CBE — show instructions.
        toast.message('CBE transfer instructions', { description: res.checkout.instructions });
      } else {
        toast.error('Unknown checkout response');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-2">
      <Select value={method} onValueChange={(v) => setMethod(v as any)}>
        <SelectTrigger className="w-full"><SelectValue placeholder="Payment method" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="telebirr">Telebirr</SelectItem>
          <SelectItem value="cbe">CBE Birr (manual)</SelectItem>
        </SelectContent>
      </Select>
      <Button onClick={start} disabled={loading} className="w-full">{loading ? 'Starting…' : 'Subscribe'}</Button>
    </div>
  );
}
