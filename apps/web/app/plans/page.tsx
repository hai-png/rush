'use client';
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, CardContent, Badge } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { useToast } from '@addis/ui';
import { useFormatMoney } from '@addis/i18n';
import { Check } from 'lucide-react';

/**
 * Plan picker page. Lists available subscription plans, lets the rider select
 * one + a route, then navigates to /checkout with the selection.
 *
 * The actual plan-picker-client.tsx component + its test live here too; this
 * page is the server-rendered wrapper that fetches plans + routes and passes
 * them to the client component.
 */
export default function PlansPage() {
  return <PlansClient />;
}

function PlansClient() {
  const router = useRouter();
  const params = useSearchParams();
  const client = useApiClient();
  const money = useFormatMoney();
  const { push } = useToast();
  const [selectedPlan, setSelectedPlan] = useState<string | null>(params.get('planId'));
  const [selectedRoute, setSelectedRoute] = useState<string | null>(params.get('routeId'));

  // Inline data fetching — in a production app this would be useQuery hooks,
  // but for a single-page picker this keeps the component self-contained.
  const [plans, setPlans] = useState<any[] | null>(null);
  const [routes, setRoutes] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // FIX (WEB-002 / UX-005): useEffect with cleanup + error state. The
  // previous useState-initializer pattern fired twice in Strict Mode and
  // had no error handling. Now: on fetch failure, set `error=true` so the
  // render shows a retry button instead of an empty grid.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ data: planData }, { data: routeData }] = await Promise.all([
          client.GET('/api/v1/plans'),
          client.GET('/api/v1/routes', { params: { query: { limit: 50 } } }),
        ]);
        if (cancelled) return;
        setPlans(planData ?? []);
        setRoutes(routeData ?? []);
        setLoading(false);
      } catch {
        if (!cancelled) { setError(true); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [client]);

  if (loading) {
    return (
      <div className="px-5 py-10 max-w-3xl mx-auto">
        <h1 className="text-xl font-semibold mb-6">Choose a plan</h1>
        <div className="grid sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}><CardContent className="h-48 animate-pulse bg-secondary/50" /></Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-5 py-10 max-w-3xl mx-auto text-center">
        <h1 className="text-xl font-semibold mb-4">Couldn&apos;t load plans</h1>
        <p className="text-muted-foreground mb-6">Something went wrong. Please try again.</p>
        <Button onClick={() => { setError(false); setLoading(true); setPlans(null); setRoutes(null); }}>
          Retry
        </Button>
      </div>
    );
  }

  const continueToCheckout = () => {
    if (!selectedPlan || !selectedRoute) {
      push({ title: 'Please select a plan and a route', variant: 'error' });
      return;
    }
    router.push(`/checkout?planId=${selectedPlan}&routeId=${selectedRoute}`);
  };

  return (
    <div className="px-5 py-10 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold mb-6">Choose a plan</h1>

      <div className="grid sm:grid-cols-3 gap-4 mb-8">
        {(plans ?? []).map((p: any) => (
          <Card
            key={p.id}
            role="button"
            tabIndex={0}
            onClick={() => setSelectedPlan(p.id)}
            onKeyDown={(e) => e.key === 'Enter' && setSelectedPlan(p.id)}
            className={`cursor-pointer transition-colors ${selectedPlan === p.id ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary'}`}
          >
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium">{p.name}</p>
                {p.isPopular && <Badge>Popular</Badge>}
              </div>
              <p className="text-2xl font-semibold">{money(p.priceETB)}</p>
              <p className="text-sm text-muted-foreground">
                {p.durationDays} days · {p.ridesIncluded === -1 ? 'Unlimited' : `${p.ridesIncluded} rides`}
              </p>
              {p.isTrial && <Badge variant="warning">Trial</Badge>}
              {selectedPlan === p.id && (
                <div className="flex items-center gap-1 text-sm text-primary">
                  <Check className="h-4 w-4" /> Selected
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <h2 className="font-semibold mb-3">Pick your route</h2>
      <div className="space-y-2 mb-8">
        {(routes ?? []).map((r: any) => (
          <Card
            key={r.id}
            role="button"
            tabIndex={0}
            onClick={() => setSelectedRoute(r.id)}
            onKeyDown={(e) => e.key === 'Enter' && setSelectedRoute(r.id)}
            className={`cursor-pointer transition-colors ${selectedRoute === r.id ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary'}`}
          >
            <CardContent className="flex items-center justify-between">
              <div>
                <p className="font-medium">{r.name}</p>
                <p className="text-sm text-muted-foreground">{r.origin} → {r.destination}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">{r.durationMin} min</p>
                <p className="font-semibold">{money(r.fare)}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Button
        className="w-full"
        disabled={!selectedPlan || !selectedRoute}
        onClick={continueToCheckout}
      >
        Continue to payment
      </Button>
    </div>
  );
}
