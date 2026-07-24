import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CheckoutCompletePoller } from './checkout-complete-poller';

export const metadata: Metadata = { title: 'Checkout Complete · Addis Ride' };

export default function CheckoutCompletePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>}>
      <CheckoutCompletePoller />
    </Suspense>
  );
}
