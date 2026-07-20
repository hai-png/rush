'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@addis/ui';

export default function CheckoutCompletePage() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'processing' | 'success' | 'failed'>('processing');
  const merchOrderId = params.get('merch_order_id') ?? params.get('out_request_no');

  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 15;
    const interval = setInterval(async () => {
      attempts++;
      try {

        const res = await fetch('/api/v1/dashboard/rider', { credentials: 'include' });
        if (res.ok) {
          const json = await res.json();
          if (json?.data?.activeSubscription) {
            setStatus('success');
            clearInterval(interval);
            return;
          }
        }
      } catch {

      }
      if (attempts >= maxAttempts) {
        clearInterval(interval);

      }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-sm text-center space-y-4">
        {status === 'processing' && (
          <>
            <Loader2 className="h-12 w-12 text-primary animate-spin mx-auto" />
            <h1 className="text-xl font-semibold">Processing your payment…</h1>
            <p className="text-sm text-muted-foreground">
              We're confirming your payment with Telebirr. This usually takes a few seconds.
              {merchOrderId && <><br />Reference: <span className="font-mono">{merchOrderId}</span></>}
            </p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 className="h-12 w-12 text-success mx-auto" />
            <h1 className="text-xl font-semibold">Payment successful!</h1>
            <p className="text-sm text-muted-foreground">
              Your subscription is now active. You can track your shuttle from the dashboard.
            </p>
            <Button className="w-full" onClick={() => router.push('/dashboard/rider')}>
              Go to dashboard
            </Button>
          </>
        )}
        {status === 'failed' && (
          <>
            <h1 className="text-xl font-semibold">Payment not confirmed yet</h1>
            <p className="text-sm text-muted-foreground">
              We couldn't confirm your payment in time. If you completed the Telebirr checkout,
              your subscription will activate once the webhook arrives — check your dashboard in a minute.
            </p>
            <Button variant="outline" className="w-full" onClick={() => router.push('/dashboard/rider')}>
              Go to dashboard
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
