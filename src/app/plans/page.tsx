import Link from 'next/link';
import { db } from '@/lib/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getSession } from '@/lib/session-server';
import { CheckoutButton } from './checkout-button';

export default async function PlansPage() {
  const plans = await db.subscriptionPlan.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  const session = await getSession();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Addis Ride</Link>
          <div className="flex gap-2">
            {session ? (
              <Button asChild variant="outline"><Link href="/dashboard/rider">Dashboard</Link></Button>
            ) : (
              <>
                <Button asChild variant="outline"><Link href="/login">Sign in</Link></Button>
                <Button asChild><Link href="/signup/rider">Sign up</Link></Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-12 max-w-5xl">
        <h1 className="text-3xl font-bold mb-2">Subscription plans</h1>
        <p className="text-muted-foreground mb-8">Pick a plan, pay via Telebirr or CBE, ride daily.</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map(plan => (
            <Card key={plan.id} className={plan.isTrial ? 'border-primary' : ''}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{plan.name}</CardTitle>
                  {plan.isTrial && <Badge>Trial</Badge>}
                </div>
                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold mb-1">
                  {plan.priceCents === 0 ? 'Free' : `${(plan.priceCents / 100).toFixed(2)} ETB`}
                  <span className="text-sm font-normal text-muted-foreground"> / {plan.durationDays}d</span>
                </div>
                <div className="text-sm text-muted-foreground mb-4">
                  {plan.ridesIncluded === -1 ? 'Unlimited rides' : `${plan.ridesIncluded} rides`}
                </div>
                {session ? (
                  <CheckoutButton planId={plan.id} />
                ) : (
                  <Button asChild className="w-full"><Link href="/signup/rider">Sign up to subscribe</Link></Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
