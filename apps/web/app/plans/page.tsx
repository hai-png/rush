'use client';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, Card, CardContent } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { PlanPickerClient } from './plan-picker-client';

/**
 * Plan picker page. Lists available subscription plans, lets the rider select
 * one + a route, then navigates to /checkout with the selection.
 *
 * The presentational layer lives in `plan-picker-client.tsx` (extracted in
 * TEST-001 so it can be unit-tested in isolation); this wrapper handles data
 * fetching + loading + error states and forwards the loaded data to the
 * client component.
 */
export default function PlansPage() {
  return <PlansClient />;
}

function PlansClient() {
  const params = useSearchParams();
  const client = useApiClient();
  const [selectedPlan] = useState<string | null>(params.get('planId'));
  const [selectedRoute] = useState<string | null>(params.get('routeId'));

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

  return (
    <PlanPickerClient
      plans={plans ?? []}
      routes={routes ?? []}
      initialPlanId={selectedPlan}
      initialRouteId={selectedRoute}
    />
  );
}
