'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function RenewButton({ subId }: { subId: string }) {
  const [loading, setLoading] = useState(false);
  async function renew() {
    setLoading(true);
    try {
      const res = await api.post<{ checkout: { status: string; checkoutUrl?: string } }>(`/api/v1/subscriptions/${subId}/renew`, { paymentMethod: 'telebirr' });
      if (res.checkout.checkoutUrl) window.location.href = res.checkout.checkoutUrl;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }
  return <Button size="sm" variant="ghost" onClick={renew} disabled={loading}>{loading ? 'Renewing…' : 'Renew →'}</Button>;
}
