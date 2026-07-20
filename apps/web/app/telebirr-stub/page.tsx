'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

// FE-004: Next.js 15+ requires client components using useSearchParams to be
// wrapped in <Suspense> — otherwise the page deopts to client-side rendering
// and may fail with DynamicServerError in static generation. Wrap the inner
// component in Suspense.

function TelebirrStubInner() {
  if (process.env.NEXT_PUBLIC_TELEBIRR_ENV === 'production' || process.env.NODE_ENV === 'production') {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <p className="text-muted-foreground">This page is not available in production.</p>
      </div>
    );
  }
  const params = useSearchParams();
  const merchOrderId = params.get('merch_order_id') ?? params.get('out_request_no') ?? '';
  const amount = params.get('total_amount') ?? '';

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-sm w-full space-y-4">
        <h1 className="text-xl font-semibold text-center">Telebirr Checkout (Test Stub)</h1>
        <div className="rounded-lg border border-border p-4 space-y-2">
          <p className="text-sm"><span className="text-muted-foreground">Order:</span> <span className="font-mono">{merchOrderId}</span></p>
          <p className="text-sm"><span className="text-muted-foreground">Amount:</span> ETB {amount}</p>
        </div>
        <button
          className="w-full bg-primary text-primary-foreground rounded-lg py-3 font-medium"
          onClick={async () => {

            await fetch('/api/v1/webhooks/telebirr/notify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                merch_order_id: merchOrderId,
                trade_status: 'Success',
                total_amount: amount,
                timestamp: Date.now(),
              }),
            });
            window.location.href = `/checkout/complete?merch_order_id=${merchOrderId}`;
          }}
        >
          Confirm Payment
        </button>
        <p className="text-xs text-muted-foreground text-center">
          This is a test stub. In production, you would be redirected to the real Telebirr H5 checkout.
        </p>
      </div>
    </div>
  );
}

export default function TelebirrStubPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Loading…</p></div>}>
      <TelebirrStubInner />
    </Suspense>
  );
}
