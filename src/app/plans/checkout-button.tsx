'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function CheckoutButton({ planId }: { planId: string }) {
  const router = useRouter();
  const [method, setMethod] = useState<'telebirr' | 'cbe'>('telebirr');
  const [corporateCode, setCorporateCode] = useState('');
  const [loading, setLoading] = useState(false);

  async function start() {
    setLoading(true);
    try {
      const payload: any = { planId, paymentMethod: method };
      if (corporateCode.trim()) payload.corporateCode = corporateCode.trim();
      const res = await api.post<{ checkout: { status: string; checkoutUrl?: string; instructions?: string }; paymentReference: string }>('/api/v1/subscriptions', payload);
      if (res.checkout.status === 'checkout' && res.checkout.checkoutUrl) {
        router.push(res.checkout.checkoutUrl);
      } else if (res.checkout.status === 'manual') {
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
      <div>
        <Label className="text-xs text-muted-foreground">Corporate code (optional)</Label>
        <Input value={corporateCode} onChange={e => setCorporateCode(e.target.value.toUpperCase())} placeholder="Enter code for subsidy" className="h-8 text-sm" />
      </div>
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
