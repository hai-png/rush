'use client';
import { useSearchParams } from 'next/navigation';

/**
 * Telebirr checkout stub for E2E / test environments.
 *
 * When TELEBIRR_ENV=testbed, the TelebirrProvider should return a checkoutUrl
 * pointing here instead of the real Telebirr H5 page. This page simulates the
 * Telebirr checkout flow: it shows the order details and a "Confirm Payment"
 * button that calls the webhook endpoint to simulate a successful payment.
 *
 * FIX (WEB-001): The previous comment claimed "In production this page is
 * never reached" — but it was a normal Next.js route, fully reachable at
 * /telebirr-stub by anyone in any environment. The page POSTs an UNSIGNED
 * webhook payload to /api/v1/webhooks/telebirr/notify. The webhook handler
 * correctly rejects invalid signatures (returns 401), so this stub on its
 * own does not bypass signature verification. However, defense in depth
 * dictates the route should not exist in production at all — a future
 * refactor that breaks signature verification would expose the stub as an
 * instant payment-bypass primitive. We now early-return (render nothing)
 * whenever NEXT_PUBLIC_TELEBIRR_ENV indicates production. The actual 404 is
 * produced by Next.js middleware so the route is unreachable in the router.
 */
export default function TelebirrStubPage() {
  // Public env var so the check runs client-side (no SSR secret leak).
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
            // Simulate a successful payment notification to our webhook.
            // In a real E2E test, this would be handled by the test framework
            // calling the webhook directly with a signed payload.
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
