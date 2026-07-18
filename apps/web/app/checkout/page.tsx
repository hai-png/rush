'use client';
import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CreditCard, Landmark } from 'lucide-react';
import { Button, Card, CardContent } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { useToast } from '@addis/ui';

export default function CheckoutPage() {
  const params = useSearchParams();
  const router = useRouter();
  const client = useApiClient();
  const { push } = useToast();
  const [method, setMethod] = useState<'telebirr' | 'cbe'>('telebirr');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    const { data, error } = await client.POST('/api/v1/subscriptions', {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: { planId: params.get('planId')!, routeId: params.get('routeId')!, paymentMethod: method },
    });
    setLoading(false);
    if (error) { push({ title: 'Could not start checkout', variant: 'error' }); return; }

    const checkout = (data as any).meta?.checkout;
    if (checkout?.status === 'checkout') {
      window.location.href = checkout.checkoutUrl; // telebirr H5 redirect
    } else if (checkout?.status === 'manual') {
      router.push(`/checkout/cbe-instructions?ref=${checkout.instructions.reference}&amount=${checkout.instructions.amount}`);
    }
  };

  return (
    <div className="min-h-screen px-6 py-10 max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-6">Choose payment method</h1>
      <div className="space-y-3">
        <Card className={method === 'telebirr' ? 'border-primary' : ''} onClick={() => setMethod('telebirr')}>
          <CardContent className="flex items-center gap-3 cursor-pointer">
            <CreditCard className="h-5 w-5 text-primary" />
            <div><p className="font-medium">telebirr</p><p className="text-xs text-muted-foreground">Instant, mobile money</p></div>
          </CardContent>
        </Card>
        <Card className={method === 'cbe' ? 'border-primary' : ''} onClick={() => setMethod('cbe')}>
          <CardContent className="flex items-center gap-3 cursor-pointer">
            <Landmark className="h-5 w-5 text-primary" />
            <div><p className="font-medium">CBE Birr</p><p className="text-xs text-muted-foreground">Manual bank transfer</p></div>
          </CardContent>
        </Card>
      </div>
      <Button className="w-full mt-8" loading={loading} onClick={submit}>Continue</Button>
    </div>
  );
}
