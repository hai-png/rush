import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bus, CreditCard, Users, Shield, Ticket, MapPin, Bell, ChevronRight, Zap, Clock, TrendingUp, CheckCircle2, ArrowRight } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Bus className="h-5 w-5" />
            </div>
            <span className="text-xl font-bold tracking-tight">Addis Ride</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild><Link href="/plans">Plans</Link></Button>
            <Button variant="ghost" size="sm" asChild><Link href="/help">Help</Link></Button>
            <Button variant="ghost" size="sm" asChild><Link href="/login">Sign in</Link></Button>
            <Button size="sm" asChild><Link href="/signup/rider">Get started</Link></Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden border-b">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/10" />
        <div className="container mx-auto px-4 py-20 md:py-32 max-w-6xl relative">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="space-y-6">
              <Badge variant="outline" className="px-3 py-1 text-sm">
                <MapPin className="h-3 w-3 mr-1" /> Addis Ababa · Shuttle Subscription
              </Badge>
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-tight">
                Your daily commute,<br />
                <span className="text-primary">simplified.</span>
              </h1>
              <p className="text-lg text-muted-foreground max-w-lg leading-relaxed">
                Subscribe to a monthly shuttle plan on routes you actually ride.
                Pay with Telebirr. Track your shuttle in real-time. Never wait in
                line again.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button size="lg" asChild>
                  <Link href="/signup/rider">Start riding <ArrowRight className="ml-2 h-4 w-4" /></Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/plans">View plans</Link>
                </Button>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2 pt-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> No free plan — pay for value</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Telebirr + CBE Birr</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Real-time GPS tracking</span>
              </div>
            </div>
            <div className="hidden md:block">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 to-transparent rounded-3xl blur-2xl" />
                <Card className="relative border-2 shadow-xl">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>Monthly 30</span>
                      <Badge>Most popular</Badge>
                    </CardTitle>
                    <CardDescription>30 rides per month on any route</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="text-4xl font-bold">1,500 <span className="text-lg font-normal text-muted-foreground">ETB/mo</span></div>
                    <div className="space-y-2">
                      {['30 rides per month', 'Choose pickup location', 'Book any scheduled trip', 'Seat marketplace access', 'Real-time shuttle tracking'].map(f => (
                        <div key={f} className="flex items-center gap-2 text-sm">
                          <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" /> {f}
                        </div>
                      ))}
                    </div>
                    <Button className="w-full" asChild><Link href="/plans">Choose this plan</Link></Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-b bg-muted/30">
        <div className="container mx-auto px-4 py-8 max-w-6xl">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { icon: Users, label: 'User roles', value: '4' },
              { icon: CreditCard, label: 'Payment methods', value: '3' },
              { icon: Zap, label: 'API endpoints', value: '158+' },
              { icon: Shield, label: 'Security layers', value: '8' },
            ].map(s => (
              <div key={s.label} className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <s.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{s.value}</div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-b">
        <div className="container mx-auto px-4 py-20 max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-3">Built for everyone</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">Four roles, one platform. Whether you ride, drive, manage a company, or run the system — Addis Ride has you covered.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: Users, title: 'Riders', desc: 'Subscribe, book rides, choose pickup locations, track shuttles, trade seats on the marketplace.' },
              { icon: Bus, title: 'Contractors', desc: 'Get assigned monthly routes, upload documents, manage shuttles, board passengers, track GPS.' },
              { icon: TrendingUp, title: 'Corporate', desc: 'Onboard your company, invite employees, subsidize their rides, track usage.' },
              { icon: Shield, title: 'Admins', desc: 'Verify contractors, manage plans/routes/shuttles, view audit logs, export data, handle refunds.' },
            ].map(f => (
              <Card key={f.title} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 mb-2">
                    <f.icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-lg">{f.title}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">{f.desc}</CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-b bg-muted/30">
        <div className="container mx-auto px-4 py-20 max-w-6xl">
          <h2 className="text-3xl font-bold mb-12 text-center">How it works</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            {[
              { step: '01', title: 'Choose a plan', desc: 'Pick from 2-Week Trial, Monthly 30, or Monthly Unlimited. Pay via Telebirr or CBE Birr.' },
              { step: '02', title: 'Browse routes', desc: 'See which contractors are committed to your route this month. Choose your pickup location.' },
              { step: '03', title: 'Book rides', desc: 'Book any scheduled trip with one tap. Your subscription covers it — no per-ride payment.' },
              { step: '04', title: 'Track & ride', desc: 'Watch your shuttle approach in real-time. Board, ride, arrive. Can\'t make it? List your seat.' },
            ].map(s => (
              <div key={s.step} className="relative">
                <div className="text-5xl font-bold text-primary/20 mb-2">{s.step}</div>
                <h3 className="font-semibold text-lg mb-2">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="border-b">
        <div className="container mx-auto px-4 py-20 max-w-4xl">
          <h2 className="text-3xl font-bold mb-4 text-center">Security baked in</h2>
          <p className="text-muted-foreground text-center mb-12 max-w-2xl mx-auto">Every transaction is protected. Every action is audited. Every credential is verified.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: Shield, title: 'CSRF + JWT', desc: 'Double-submit CSRF + signed JWT cookies' },
              { icon: CreditCard, title: 'Telebirr signed', desc: 'RSA-PSS-SHA256 webhook verification' },
              { icon: Clock, title: 'Hash-chained audit', desc: 'Append-only log with integrity verification' },
              { icon: Users, title: '2FA for admins', desc: 'TOTP required for privileged roles' },
            ].map(s => (
              <Card key={s.title}>
                <CardContent className="py-4 text-center">
                  <s.icon className="h-8 w-8 mx-auto mb-2 text-primary" />
                  <div className="font-medium text-sm">{s.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">{s.desc}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Demo accounts */}
      <section className="border-b bg-muted/30">
        <div className="container mx-auto px-4 py-16 max-w-4xl">
          <h2 className="text-2xl font-bold mb-6 text-center">Try it now</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { role: 'Rider', phone: '+251911000002', pass: 'rider-pass-1234', href: '/login' },
              { role: 'Contractor', phone: '+251911000003', pass: 'contractor-pass-1234', href: '/login' },
              { role: 'Admin', phone: '+251911000001', pass: 'admin-pass-1234', href: '/login' },
            ].map(a => (
              <Card key={a.role}>
                <CardContent className="py-4">
                  <div className="font-medium mb-1">{a.role}</div>
                  <div className="text-xs text-muted-foreground font-mono space-y-0.5">
                    <div>phone: {a.phone}</div>
                    <div>pass: {a.pass}</div>
                  </div>
                  <Button asChild variant="outline" size="sm" className="mt-2 w-full">
                    <Link href={a.href}>Sign in as {a.role}</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-b">
        <div className="container mx-auto px-4 py-20 max-w-4xl text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to ride?</h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">Sign up in 30 seconds. Choose a plan. Start riding tomorrow.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button size="lg" asChild><Link href="/signup/rider">Sign up as rider</Link></Button>
            <Button size="lg" variant="outline" asChild><Link href="/signup/contractor">Drive for us</Link></Button>
            <Button size="lg" variant="ghost" asChild><Link href="/corporate/onboard">Onboard a company</Link></Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-muted/30 mt-auto">
        <div className="container mx-auto px-4 py-8 max-w-6xl">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
            <div>
              <div className="font-semibold mb-2">Addis Ride</div>
              <div className="text-muted-foreground">Shuttle subscription platform for Addis Ababa.</div>
            </div>
            <div>
              <div className="font-semibold mb-2">Quick links</div>
              <div className="space-y-1 text-muted-foreground">
                <Link href="/plans" className="block hover:text-foreground">Plans</Link>
                <Link href="/trips" className="block hover:text-foreground">Browse trips</Link>
                <Link href="/assignments" className="block hover:text-foreground">Routes</Link>
                <Link href="/open-seats" className="block hover:text-foreground">Marketplace</Link>
              </div>
            </div>
            <div>
              <div className="font-semibold mb-2">Account</div>
              <div className="space-y-1 text-muted-foreground">
                <Link href="/login" className="block hover:text-foreground">Sign in</Link>
                <Link href="/signup/rider" className="block hover:text-foreground">Sign up</Link>
                <Link href="/help" className="block hover:text-foreground">Help & FAQ</Link>
                <Link href="/account" className="block hover:text-foreground">My account</Link>
              </div>
            </div>
            <div>
              <div className="font-semibold mb-2">Contact</div>
              <div className="space-y-1 text-muted-foreground">
                <div>dpo@addisride.et</div>
                <div>Addis Ababa, Ethiopia</div>
              </div>
            </div>
          </div>
          <div className="border-t mt-6 pt-4 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
            <span>© {new Date().getFullYear()} Addis Ride</span>
            <span>Powered by Telebirr · Twilio · Resend</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
