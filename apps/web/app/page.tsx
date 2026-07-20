import Link from 'next/link';
import { Bus, ShieldCheck, Building2 } from 'lucide-react';
import { Button } from '@addis/ui';
import { getServerApiClient } from '@/lib/server-api';

export default async function LandingPage() {
  const client = await getServerApiClient();
  const { data: routes } = await client.GET('/api/v1/routes', { params: { query: { limit: 3 } } });

  return (
    <main>
      <section className="px-6 pt-20 pb-16 text-center max-w-2xl mx-auto">
        <h1 className="text-4xl font-bold leading-tight">Skip the rush-hour scramble.</h1>
        <p className="text-muted-foreground mt-4">
          Addis Ride is a subscription shuttle service for your daily commute — fixed routes, confirmed seats, live tracking.
        </p>
        <div className="flex justify-center gap-3 mt-8">
          <Link href="/signup/rider"><Button size="lg">Subscribe as a rider</Button></Link>
          <Link href="/plans"><Button size="lg" variant="outline">See plans</Button></Link>
        </div>
      </section>

      <section className="px-6 py-12 grid sm:grid-cols-3 gap-6 max-w-4xl mx-auto">
        <Feature icon={Bus} title="Fixed routes" desc="Six commuter routes across Addis Ababa, morning + evening windows." />
        <Feature icon={ShieldCheck} title="Verified contractors" desc="Every driver and vehicle is document-verified before running trips." />
        <Feature icon={Building2} title="Corporate subsidies" desc="Employers can subsidize up to 70% of employee commute costs." />
      </section>

      <section className="px-6 py-12 max-w-4xl mx-auto">
        <h2 className="font-semibold mb-4">Popular routes</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {(routes ?? []).map((r: any) => (
            <div key={r.id} className="rounded-2xl border border-border p-4">
              <p className="font-medium">{r.origin} → {r.destination}</p>
              <p className="text-sm text-muted-foreground">{r.durationMin} min · ETB {r.fare}/ride</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function Feature({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="text-center">
      <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3">
        <Icon className="h-6 w-6" />
      </div>
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground mt-1">{desc}</p>
    </div>
  );
}
