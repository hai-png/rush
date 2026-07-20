'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardContent, Badge } from '@addis/ui';
import { useToast } from '@addis/ui';
import { useFormatMoney } from '@addis/i18n';
import { Check } from 'lucide-react';

/**
 * Client component for the plan-picker page. Renders the grid of subscription
 * plans + the list of routes, tracks the user's selections in local state,
 * and (when both are chosen) navigates to /checkout.
 *
 * Extracted from `page.tsx` (TEST-001) so the presentational layer can be
 * unit-tested in isolation — `page.tsx` keeps the data-fetching + loading +
 * error states and forwards the loaded data here as props.
 */
export type PlanPickerPlan = {
  id: string;
  name: string;
  description?: string;
  durationDays: number;
  ridesIncluded: number;
  priceETB: string;
  isPopular?: boolean;
  isTrial?: boolean;
};
export type PlanPickerRoute = {
  id: string;
  name: string;
  origin?: string;
  destination?: string;
  durationMin?: number;
  fare: string;
};

export function PlanPickerClient({
  plans,
  routes,
  initialPlanId = null,
  initialRouteId = null,
}: {
  plans: PlanPickerPlan[];
  routes: PlanPickerRoute[];
  initialPlanId?: string | null;
  initialRouteId?: string | null;
}) {
  const router = useRouter();
  const money = useFormatMoney();
  const { push } = useToast();
  const [selectedPlan, setSelectedPlan] = useState<string | null>(initialPlanId);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(initialRouteId);

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
        {plans.map((p) => (
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
        {routes.map((r) => (
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
                {r.origin && r.destination && (
                  <p className="text-sm text-muted-foreground">{r.origin} → {r.destination}</p>
                )}
              </div>
              <div className="text-right">
                {r.durationMin != null && (
                  <p className="text-sm text-muted-foreground">{r.durationMin} min</p>
                )}
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
