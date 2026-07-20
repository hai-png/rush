'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CreditCard, Landmark } from 'lucide-react';
import { Button, Card, CardContent } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { useToast } from '@addis/ui';

// Allow-list of payment-provider checkout URL hosts. The previous
// implementation did `window.location.href = checkout.checkoutUrl` with no
// validation — if the API or Telebirr was compromised/tampered, the user
// would be redirected to an arbitrary URL (phishing, malware drive-by).
const ALLOWED_CHECKOUT_HOSTS = new Set([
  'superapp.ethiomobilemoney.et',     // Telebirr production
  'developerportal.ethiotelecom.et', // Telebirr testbed
  'localhost',                         // dev
]);

function isAllowedCheckoutUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && ALLOWED_CHECKOUT_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

// FIX (FE-006): The previous idempotency key was `checkout:${planId}:${routeId}`
// — stable FOREVER for a given (plan, route). If a rider started checkout,
// abandoned it, came back minutes later, and re-submitted, the server's
// idempotency layer returned the CACHED response (the original Telebirr
// checkout URL) instead of minting a fresh subscription. The cached URL was
// typically already expired or already consumed. We now salt the key with a
// `sessionStorage`-backed per-page-load nonce so:
//   - Within a single page-load, the key is stable → double-click /
//     strict-mode double-mount dedupes server-side (one subscription).
//   - Across page-loads (full reload, new tab, or after a successful
//     checkout), the nonce differs → the server treats it as a fresh
//     request and mints a new subscription + new Telebirr checkout URL.
// The nonce is cleared on successful checkout (POST 2xx) and when the
// `?checkout_done=1` query param is present (the Telebirr redirect-back
// signal) so the next visit starts a fresh nonce.
const NONCE_STORAGE_KEY = 'addisride.checkout.nonce';

function getOrCreateNonce(): string {
  if (typeof window === 'undefined') return 'ssr-placeholder';
  try {
    const existing = window.sessionStorage.getItem(NONCE_STORAGE_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.sessionStorage.setItem(NONCE_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // sessionStorage can throw in private-mode browsers; fall back to a
    // per-mount random value (loses strict-mode dedupe but stays correct).
    return crypto.randomUUID();
  }
}

function clearNonce() {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(NONCE_STORAGE_KEY); } catch { /* noop */ }
}

export default function CheckoutPage() {
  const params = useSearchParams();
  const router = useRouter();
  const client = useApiClient();
  const { push } = useToast();
  const [method, setMethod] = useState<'telebirr' | 'cbe'>('telebirr');
  const [loading, setLoading] = useState(false);

  const planId = params.get('planId');
  const routeId = params.get('routeId');

  // Per-page-load nonce — useState initializer runs once per mount and
  // reads from sessionStorage so React Strict Mode's double-mount (and
  // HMR) reuse the same nonce rather than minting two.
  const [nonce] = useState(() => getOrCreateNonce());

  // Generate a STABLE idempotency key per checkout session (plan + route +
  // page-load nonce). Stable across re-renders within a single page-load
  // (double-click / strict-mode-safe), different across page-loads (so a
  // rider who abandons and returns gets a fresh server-side request).
  const idempotencyKey = useMemo(() => {
    if (!planId || !routeId) return null;
    return `checkout:${planId}:${routeId}:${nonce}`;
  }, [planId, routeId, nonce]);

  // FE-006: clear the nonce when the Telebirr redirect-back signal is
  // present so the next visit to /checkout starts a fresh checkout flow.
  useEffect(() => {
    if (params.get('checkout_done') === '1') {
      clearNonce();
    }
  }, [params]);

  const submit = async () => {
    if (!planId || !routeId || !idempotencyKey) {
      push({ title: 'Missing plan or route — please go back and try again', variant: 'error' });
      return;
    }
    setLoading(true);
    const { data, error } = await client.POST('/api/v1/subscriptions', {
      headers: { 'Idempotency-Key': idempotencyKey },
      body: { planId, routeId, paymentMethod: method },
    });
    setLoading(false);
    if (error) { push({ title: error.message ?? 'Could not start checkout', variant: 'error' }); return; }

    // FE-006: clear the nonce on successful checkout so a subsequent visit
    // (e.g., via the browser back button) mints a fresh subscription
    // instead of reusing the now-consumed idempotency key.
    clearNonce();

    const checkout = (data as any).meta?.checkout;
    if (checkout?.status === 'checkout') {
      // Validate the URL before redirecting — open-redirect protection.
      if (!isAllowedCheckoutUrl(checkout.checkoutUrl)) {
        push({ title: 'Invalid checkout URL returned by payment provider', variant: 'error' });
        return;
      }
      window.location.href = checkout.checkoutUrl;
    } else if (checkout?.status === 'manual') {
      router.push(`/checkout/cbe-instructions?ref=${checkout.instructions.reference}&amount=${checkout.instructions.amount}`);
    }
  };

  return (
    <div className="min-h-screen px-6 py-10 max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-6">Choose payment method</h1>
      <div className="space-y-3">
        <Card
          className={method === 'telebirr' ? 'border-primary' : ''}
          onClick={() => setMethod('telebirr')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMethod('telebirr'); } }}
        >
          <CardContent className="flex items-center gap-3 cursor-pointer">
            <CreditCard className="h-5 w-5 text-primary" />
            <div><p className="font-medium">telebirr</p><p className="text-xs text-muted-foreground">Instant, mobile money</p></div>
          </CardContent>
        </Card>
        <Card
          className={method === 'cbe' ? 'border-primary' : ''}
          onClick={() => setMethod('cbe')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMethod('cbe'); } }}
        >
          <CardContent className="flex items-center gap-3 cursor-pointer">
            <Landmark className="h-5 w-5 text-primary" />
            <div><p className="font-medium">CBE Birr</p><p className="text-xs text-muted-foreground">Manual bank transfer</p></div>
          </CardContent>
        </Card>
      </div>
      <Button className="w-full mt-8" loading={loading} onClick={submit} disabled={!planId || !routeId}>Continue</Button>
    </div>
  );
}
