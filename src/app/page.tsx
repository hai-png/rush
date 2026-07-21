// Landing page — entry point. Shows app overview, links to all flows.
// The preview pane renders / by default; deeper routes are reachable by navigation.

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bus, CreditCard, Users, Shield, Ticket, MapPin, Bell, ChevronRight } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <Bus className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold">Addis Ride</span>
            <Badge variant="secondary" className="ml-2">Clean rebuild</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild>
              <Link href="/signup/rider">Get started</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="border-b">
          <div className="container mx-auto px-4 py-20 md:py-28 max-w-5xl">
            <div className="flex flex-col items-start gap-6">
              <Badge variant="outline">Shuttle subscription platform · Addis Ababa</Badge>
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
                Ride every day.<br />
                <span className="text-muted-foreground">Pay once a month.</span>
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground max-w-2xl">
                Subscribe to a monthly shuttle plan on routes you actually ride. Pay with Telebirr
                or CBE Birr. Missed a ride? List your seat on the marketplace and let someone else use it.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button size="lg" asChild>
                  <Link href="/signup/rider">Sign up as rider</Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/signup/contractor">Drive for us</Link>
                </Button>
                <Button size="lg" variant="ghost" asChild>
                  <Link href="/login">Sign in <ChevronRight className="ml-1 h-4 w-4" /></Link>
                </Button>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground pt-4">
                <span className="flex items-center gap-1"><Shield className="h-4 w-4" /> Append-only audit log</span>
                <span className="flex items-center gap-1"><CreditCard className="h-4 w-4" /> Telebirr + CBE Birr</span>
                <span className="flex items-center gap-1"><Users className="h-4 w-4" /> Rider / contractor / corporate / admin</span>
              </div>
            </div>
          </div>
        </section>

        {/* Demo credentials */}
        <section className="border-b bg-muted/30">
          <div className="container mx-auto px-4 py-10 max-w-5xl">
            <h2 className="text-lg font-semibold mb-4">Demo accounts (already seeded)</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Rider</CardTitle>
                  <CardDescription>For testing subscription + checkout flow</CardDescription>
                </CardHeader>
                <CardContent className="text-sm space-y-1 font-mono">
                  <div>phone: <span className="text-foreground">+251911000002</span></div>
                  <div>pass: <span className="text-foreground">rider-pass-1234</span></div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Contractor</CardTitle>
                  <CardDescription>For testing trip + ride operations</CardDescription>
                </CardHeader>
                <CardContent className="text-sm space-y-1 font-mono">
                  <div>phone: <span className="text-foreground">+251911000003</span></div>
                  <div>pass: <span className="text-foreground">contractor-pass-1234</span></div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Platform admin</CardTitle>
                  <CardDescription>For testing admin dashboard</CardDescription>
                </CardHeader>
                <CardContent className="text-sm space-y-1 font-mono">
                  <div>phone: <span className="text-foreground">+251911000001</span></div>
                  <div>pass: <span className="text-foreground">admin-pass-1234</span></div>
                </CardContent>
              </Card>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              Payments run in <strong>mock mode</strong> by default — Telebirr returns a fake
              checkout URL pointing at <code>/telebirr-stub</code>, which simulates the redirect
              and fires the real webhook handler. To use real Telebirr testbed creds, set the
              <code> TELEBIRR_*</code> env vars.
            </p>
          </div>
        </section>

        {/* Feature grid */}
        <section className="border-b">
          <div className="container mx-auto px-4 py-16 max-w-5xl">
            <h2 className="text-2xl font-bold mb-8">What's in the clean rebuild</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Feature icon={Users} title="Four roles, one auth system" body="Rider, contractor, corporate_admin, platform_admin. JWT-in-cookie (no dual NextAuth + Hono JWT smell)." />
              <Feature icon={CreditCard} title="Telebirr dedup done right" body="Composite PK (merchOrderId, outRequestNo) baked in from the start — no 3-migration churn." />
              <Feature icon={Shield} title="Refund row-lock" body="scheduleRefund runs inside a transaction so two concurrent refunds can't over-refund the customer." />
              <Feature icon={MapPin} title="Seat marketplace" body="Subscribers can release a seat they can't use; other riders claim it for the route fare." />
              <Feature icon={Ticket} title="Support tickets" body="Per-user tickets with category, priority, and threaded messages. Admin can resolve/close." />
              <Feature icon={Bell} title="Append-only audit log" body="Hash-chained audit trail. No update/delete path exposed. Admin endpoint verifies the chain." />
            </div>
          </div>
        </section>

        {/* Quick links */}
        <section>
          <div className="container mx-auto px-4 py-16 max-w-5xl">
            <h2 className="text-2xl font-bold mb-8">Jump to a page</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
              {[
                ['/login', 'Sign in'],
                ['/signup/rider', 'Rider signup'],
                ['/signup/contractor', 'Contractor signup'],
                ['/signup/corporate', 'Corporate signup'],
                ['/plans', 'Subscription plans'],
                ['/dashboard/rider', 'Rider dashboard'],
                ['/dashboard/contractor', 'Contractor dashboard'],
                ['/dashboard/admin', 'Admin dashboard'],
                ['/open-seats', 'Seat marketplace'],
                ['/tickets', 'Support tickets'],
                ['/notifications', 'Notifications'],
                ['/account', 'Account'],
                ['/telebirr-stub', 'Telebirr mock stub'],
                ['/help', 'Help & FAQ'],
                ['/admin/audit-logs', 'Audit logs'],
                ['/admin/users', 'Admin: users'],
              ].map(([href, label]) => (
                <Link key={href} href={href}
                  className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-accent transition-colors">
                  <span>{label}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t bg-muted/30">
        <div className="container mx-auto px-4 py-6 max-w-5xl text-sm text-muted-foreground flex flex-wrap justify-between gap-2">
          <span>© {new Date().getFullYear()} Addis Ride — clean reimplementation</span>
          <span>Built from <code>rush</code> @ critical-review-zharden, rewritten from scratch</span>
        </div>
      </footer>
    </div>
  );
}

function Feature({ icon: Icon, title, body }: { icon: any; title: string; body: string }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{body}</CardContent>
    </Card>
  );
}
