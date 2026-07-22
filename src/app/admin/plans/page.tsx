import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { SignOutButton } from '@/components/sign-out-button';
import { NewPlanForm } from './new-plan-form';

export default async function AdminPlansPage() {
  await requireRole('platform_admin');
  const plans = await db.subscriptionPlan.findMany({ orderBy: { sortOrder: 'asc' } });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard/admin" className="text-xl font-bold">Admin · Plans</Link>
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-2xl font-bold mb-4">Subscription plans</h1>
        <Card className="mb-6">
          <CardContent className="py-3 divide-y text-sm">
            {plans.map(p => (
              <div key={p.id} className="py-2 flex justify-between">
                <div>
                  <div className="font-medium">{p.name} ({p.slug})</div>
                  <div className="text-xs text-muted-foreground">{p.description}</div>
                </div>
                <div className="text-right text-xs">
                  <div>{(p.priceCents / 100).toFixed(2)} ETB · {p.durationDays}d</div>
                  <div className="text-muted-foreground">{p.ridesIncluded === -1 ? 'unlimited' : `${p.ridesIncluded} rides`}{p.isTrial ? ' · trial' : ''}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <h2 className="text-lg font-semibold mb-3">Create new plan</h2>
        <NewPlanForm />
      </main>
    </div>
  );
}
