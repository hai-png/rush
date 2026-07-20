'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CreditCard, Landmark } from 'lucide-react';
import { Button, Card, CardContent } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { useToast } from '@addis/ui';

const ALLOWED_CHECKOUT_HOSTS = new Set([
  'superapp.ethiomobilemoney.et',
  'developerportal.ethiotelecom.et',
  'localhost',
]);

function isAllowedCheckoutUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && ALLOWED_CHECKOUT_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

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

    return crypto.randomUUID();
  }
}

function clearNonce() {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(NONCE_STORAGE_KEY); } catch {  }
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

  const [nonce] = useState(() => getOrCreateNonce());

  const idempotencyKey = useMemo(() => {
    if (!planId || !routeId) return null;
    return `checkout:${planId}:${routeId}:${nonce}`;
  }, [planId, routeId, nonce]);

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

    clearNonce();

    const checkout = (data as any).meta?.checkout;
    if (checkout?.status === 'checkout') {

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
