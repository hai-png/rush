import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CheckoutCompletePoller } from './checkout-complete-poller';

export const metadata: Metadata = { title: 'Checkout Complete · Addis Ride' };

// FE-053: previously this page was a static "processing…" message. The user
// had no idea whether their payment had actually settled. Now it's a client
// component (rendered through this thin server wrapper so we can export
// metadata) that polls the subscription / payment endpoint until it becomes
// active/confirmed, then redirects to the rider dashboard. If polling
// exceeds 60s we surface a "taking longer than expected" message so the
// user knows to contact support instead of staring at a spinner forever.
//
// Suspense is required around the poller because it calls `useSearchParams`,
// which during static prerender would otherwise force the whole page to bail
// out to client-side rendering.
export default function CheckoutCompletePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>}>
      <CheckoutCompletePoller />
    </Suspense>
  );
}
