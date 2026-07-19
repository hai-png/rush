'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@addis/ui';

/**
 * Telebirr redirect-back URL (TELEBIRR_REDIRECT_URL).
 *
 * Telebirr redirects here after the user completes (or cancels) the H5 checkout.
 * The payment itself is confirmed asynchronously via the /webhooks/telebirr/notify
 * webhook — this page just confirms to the user that they can return to the
 * dashboard and that their subscription will activate once the webhook fires.
 *
 * We poll /api/v1/dashboard/rider for up to 30 seconds; if the activeSubscription
 * appears, we show a success state. If not, we show a "still processing" state
 * and let the user go to their dashboard to check later.
 */
export default function CheckoutCompletePage() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'processing' | 'success' | 'failed'>('processing');
  const merchOrderId = params.get('merch_order_id') ?? params.get('out_request_no');

  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 15; // 15 polls × 2s = 30s max
    const interval = setInterval(async () => {
      attempts++;
      try {
        // The web app uses NextAuth cookie-based auth — no explicit
        // Authorization header needed (cookies are sent automatically for
        // same-origin requests). The original implementation sent an empty
        // Bearer token via localStorage.getItem('addisride.accessToken'),
        // which is a mobile-app pattern that doesn't apply to the web app.
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
        // ignore — keep polling
      }
      if (attempts >= maxAttempts) {
        clearInterval(interval);
        // Stay in 'processing' — the webhook may still fire.
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
