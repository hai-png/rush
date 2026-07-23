'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api-client';

// Polls /api/v1/subscriptions/:id (preferred) or /api/v1/payments/:id every
// 2.5s. Redirects to /dashboard/rider when the subscription becomes 'active'
// or the payment becomes 'confirmed' (or 'completed'). After 60s of polling
// without a terminal state we surface a "taking longer than expected" message
// with a support link so the user isn't stuck on a spinner.

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

  // Skip the effect entirely when there is no id — render the error state directly.
  useEffect(() => {
    if (!id) return;

    stoppedRef.current = false;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (stoppedRef.current) return;

      // Check the wall-clock timeout first so we don't poll forever even if
      // the network is fast but the backend never reaches a terminal state.
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
        // Subscription: 'active' means payment settled and sub is usable.
        // Payment: 'confirmed' / 'completed' both mean the money landed.
        const done = type === 'payment'
          ? status === 'confirmed' || status === 'completed'
          : status === 'active';
        if (done) {
          setState({ kind: 'success' });
          // Brief beat so the success state is visible before the redirect.
          setTimeout(() => {
            if (!stoppedRef.current) router.push('/dashboard/rider');
          }, 600);
          return;
        }
      } catch (err) {
        if (stoppedRef.current) return;
        // 404 means the id is wrong / not owned by this user — bail out
        // with a friendly message. Other transient errors (network, 5xx)
        // should keep retrying until the timeout fires.
        if (err instanceof ApiError && err.status === 404) {
          setState({ kind: 'error', message: 'We could not find this payment. If you just completed checkout, please refresh in a moment.' });
          return;
        }
        // Otherwise fall through and schedule the next tick.
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
