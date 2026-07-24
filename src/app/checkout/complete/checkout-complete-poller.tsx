'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api-client';

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 60_000;

type PollState =
  | { kind: 'polling' }
  | { kind: 'success' }
  | { kind: 'timeout' }
  | { kind: 'error'; message: string };

export function CheckoutCompletePoller() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get('id') ?? '';
  const type = (searchParams.get('type') ?? 'subscription') as 'subscription' | 'payment';

  const [state, setState] = useState<PollState>({ kind: 'polling' });
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!id) return;

    stoppedRef.current = false;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (stoppedRef.current) return;

      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setState({ kind: 'timeout' });
        return;
      }

      const path = type === 'payment'
        ? `/api/v1/payments/${encodeURIComponent(id)}`
        : `/api/v1/subscriptions/${encodeURIComponent(id)}`;

      try {
        const data = await api.get<{ status?: string }>(path);
        if (stoppedRef.current) return;
        const status = (data?.status ?? '').toLowerCase();
        const done = type === 'payment'
          ? status === 'confirmed' || status === 'completed'
          : status === 'active';
        if (done) {
          setState({ kind: 'success' });
          setTimeout(() => {
            if (!stoppedRef.current) router.push('/dashboard/rider');
          }, 600);
          return;
        }
      } catch (err) {
        if (stoppedRef.current) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ kind: 'error', message: 'We could not find this payment. If you just completed checkout, please refresh in a moment.' });
          return;
        }
      }

      timer = setTimeout(tick, POLL_INTERVAL_MS);
    }

    tick();

    return () => {
      stoppedRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, type, router]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md text-center space-y-4">
        {!id ? (
          <>
            <h1 className="text-2xl font-bold">Something went wrong</h1>
            <p className="text-muted-foreground">No payment id found in the redirect URL.</p>
            <Button asChild><Link href="/dashboard/rider">Go to dashboard</Link></Button>
          </>
        ) : state.kind === 'polling' && (
          <>
            <Loader2 className="h-16 w-16 text-primary mx-auto animate-spin" />
            <h1 className="text-2xl font-bold">Processing your payment…</h1>
            <p className="text-muted-foreground">
              We are confirming your payment with Telebirr. This usually takes a few seconds.
              You will be redirected automatically.
            </p>
          </>
        )}
        {state.kind === 'success' && (
          <>
            <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto" />
            <h1 className="text-2xl font-bold">Payment confirmed</h1>
            <p className="text-muted-foreground">Redirecting you to your dashboard…</p>
          </>
        )}
        {state.kind === 'timeout' && (
          <>
            <h1 className="text-2xl font-bold">Taking longer than expected</h1>
            <p className="text-muted-foreground">
              We have not received confirmation from Telebirr yet. If you completed payment,
              your subscription will be activated automatically once the webhook lands —
              please check your dashboard in a few minutes. If you did not complete payment,
              please retry checkout.
            </p>
            <div className="flex gap-2 justify-center">
              <Button asChild><Link href="/dashboard/rider">Go to dashboard</Link></Button>
              <Button asChild variant="outline"><Link href="/help">Contact support</Link></Button>
            </div>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <h1 className="text-2xl font-bold">Something went wrong</h1>
            <p className="text-muted-foreground">{state.message}</p>
            <Button asChild><Link href="/dashboard/rider">Go to dashboard</Link></Button>
          </>
        )}
      </div>
    </div>
  );
}
