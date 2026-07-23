'use client';

import { Suspense } from 'react';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Bus, CheckCircle2, XCircle } from 'lucide-react';

function TelebirrStubInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const order = sp.get('order') ?? '';
  const amount = sp.get('amount') ?? '';
  const title = sp.get('title') ?? 'Subscription';

  const [status, setStatus] = useState<'idle' | 'paying' | 'success' | 'failed'>('idle');

  // P3-14 / SEC-031: in production with real Telebirr configured, this mock
  // stub page shouldn't be reachable. Redirect to home if the user lands here
  // in a production build.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      router.replace('/');
    }
  }, [router]);

  async function pay(result: 'Success' | 'Fail') {
    setStatus('paying');
    try {
      // Fire the webhook handler directly.
      const payload = {
        merch_order_id: order,
        out_request_no: `orno-${Date.now()}`,
        trade_status: result,
        total_amount: amount,
        timestamp: Date.now(),
        sign: 'mock-signature',
      };
      const res = await fetch('/api/v1/webhooks/telebirr/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
      }
      setStatus(result === 'Success' ? 'success' : 'failed');
      if (result === 'Success') {
        toast.success('Payment settled');
      } else {
        toast.error('Payment failed');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Webhook call failed');
      setStatus('idle');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bus className="h-6 w-6 text-primary" />
            <CardTitle>Telebirr (mock)</CardTitle>
          </div>
          <CardDescription>This page simulates the Telebirr checkout. In real mode you'd never see this.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border p-3 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Order</span><span className="font-mono">{order}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Title</span><span>{title}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="font-semibold">{amount} ETB</span></div>
          </div>
          {status === 'success' && (
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-5 w-5" /> Payment settled. You can close this page.
            </div>
          )}
          {status === 'failed' && (
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <XCircle className="h-5 w-5" /> Payment failed.
            </div>
          )}
          {status !== 'success' && status !== 'failed' && (
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => pay('Success')} disabled={status === 'paying'}>
                {status === 'paying' ? 'Processing…' : 'Pay successfully'}
              </Button>
              <Button onClick={() => pay('Fail')} disabled={status === 'paying'} variant="outline">
                Simulate failure
              </Button>
            </div>
          )}
          <Button asChild variant="ghost" className="w-full">
            <Link href="/dashboard/rider">Go to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function TelebirrStubPage() {
  // useSearchParams() must be wrapped in a Suspense boundary so that
  // Next.js 16 can statically prerender the page shell.
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading…</div>}>
      <TelebirrStubInner />
    </Suspense>
  );
}
