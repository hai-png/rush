import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bus, MapPin, Clock, Shield, Users, TrendingUp, ArrowRight, CheckCircle2, Star } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <nav className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Bus className="h-5 w-5" />
            </div>
            <span className="text-xl font-bold tracking-tight">Addis Ride</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild><Link href="/help">How it works</Link></Button>
            <Button variant="ghost" size="sm" asChild><Link href="/plans">Pricing</Link></Button>
            <Button variant="ghost" size="sm" asChild><Link href="/login">Sign in</Link></Button>
            <Button size="sm" asChild><Link href="/signup/rider">Get started</Link></Button>
          </div>
        </div>
      </nav>

      <section className="relative overflow-hidden border-b">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/10" />
        <div className="container mx-auto px-4 py-20 md:py-32 max-w-6xl relative">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="space-y-6">
              <Badge variant="outline" className="px-3 py-1 text-sm">
                <MapPin className="h-3 w-3 mr-1" /> Now serving Addis Ababa
              </Badge>
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-tight">
                Your daily commute,<br /><span className="text-primary">simplified.</span>
              </h1>
              <p className="text-lg text-muted-foreground max-w-lg leading-relaxed">
                Subscribe to a monthly shuttle plan on routes you ride every day.
                Pay with Telebirr. Choose your pickup. Track your shuttle live.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button size="lg" asChild>
                  <Link href="/signup/rider">Start riding <ArrowRight className="ml-2 h-4 w-4" /></Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/plans">See plans</Link>
                </Button>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2 pt-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Cancel anytime</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> No per-ride payment</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Real-time tracking</span>
              </div>
            </div>
            <div className="hidden md:block">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 to-transparent rounded-3xl blur-2xl" />
                <Card className="relative border-2 shadow-xl">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>Monthly 30</span>
                      <Badge>Popular</Badge>
                    </CardTitle>
                    <CardDescription>30 rides per month on any route</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="text-4xl font-bold">1,500 <span className="text-lg font-normal text-muted-foreground">ETB/mo</span></div>
                    <div className="space-y-2">
                      {['30 rides per month', 'Choose your pickup location', 'Book any scheduled trip', 'Cancel anytime'].map(f => (
                        <div key={f} className="flex items-center gap-2 text-sm">
                          <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" /> {f}
                        </div>
                      ))}
                    </div>
                    <Button className="w-full" asChild><Link href="/plans">See all plans</Link></Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b bg-muted/30">
        <div className="container mx-auto px-4 py-20 max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-3">How it works</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">Four simple steps from signup to your seat.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            {[
              { step: '01', title: 'Choose a plan', desc: 'Pick 2-Week Trial, Monthly 30, or Monthly Unlimited. Pay via Telebirr or CBE Birr.' },
              { step: '02', title: 'Browse routes', desc: 'See which routes are available this month. Pick your preferred pickup location.' },
              { step: '03', title: 'Book rides', desc: 'Book any scheduled trip with one tap. Your subscription covers it — no extra payment.' },
              { step: '04', title: 'Track & ride', desc: 'Watch your shuttle approach in real-time. Board, ride, arrive. Missed a trip? List your seat.' },
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

      <section className="border-b">
        <div className="container mx-auto px-4 py-20 max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-3">Why Addis Ride?</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">Built for Addis Ababa commuters, by people who know the struggle.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: Clock, title: 'Save time', desc: 'No more waiting at the bus stop wondering when your ride will come. Book ahead, track live, arrive on time.' },
              { icon: Shield, title: 'Reliable & safe', desc: 'Verified contractors, insured shuttles, GPS-tracked trips. Every ride is recorded for your safety.' },
              { icon: TrendingUp, title: 'Save money', desc: 'Monthly subscriptions cost less per ride than paying daily. Corporate subsidies available for employees.' },
              { icon: MapPin, title: 'Your route, your stops', desc: 'Multiple pickup locations along each route. Choose the one closest to home or work.' },
              { icon: Users, title: 'Seat marketplace', desc: 'Can\'t make a trip? List your seat for another rider. Someone else rides, you keep your credit.' },
              { icon: Bus, title: 'Real shuttles, real drivers', desc: 'Professional contractors with verified licenses, inspected vehicles, and tracked safety records.' },
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

      <section className="border-b bg-muted/30">
        <div className="container mx-auto px-4 py-20 max-w-4xl text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">For companies</h2>
          <p className="text-muted-foreground mb-8 max-w-2xl mx-auto">
            Subsidize your employees' daily commute. Set your subsidy percentage, invite your team,
            and track usage — all from one dashboard.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {[
              { icon: Users, title: 'Invite your team', desc: 'Generate invite codes and share with employees' },
              { icon: TrendingUp, title: 'Set subsidy', desc: 'Choose what percentage you cover — 50%, 75%, 100%' },
              { icon: Shield, title: 'Track usage', desc: 'Monitor rides used, manage members, export reports' },
            ].map(f => (
              <Card key={f.title}>
                <CardContent className="py-6 text-center">
                  <f.icon className="h-8 w-8 mx-auto mb-3 text-primary" />
                  <div className="font-medium text-sm">{f.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">{f.desc}</div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Button size="lg" asChild><Link href="/corporate/onboard">Onboard your company</Link></Button>
        </div>
      </section>

      <section className="border-b">
        <div className="container mx-auto px-4 py-20 max-w-4xl text-center">
          <div className="flex justify-center gap-1 mb-4">
            {[1,2,3,4,5].map(i => <Star key={i} className="h-6 w-6 fill-yellow-400 text-yellow-400" />)}
          </div>
          <blockquote className="text-xl md:text-2xl font-medium mb-4">
            "I used to spend 40 minutes waiting for a bus every morning. Now I book my seat the night before, track the shuttle, and I'm at work by 8."
          </blockquote>
          <p className="text-muted-foreground">— Selam, Bole → Merkato commuter</p>
        </div>
      </section>

      <section className="border-b bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 py-20 max-w-4xl text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to ride?</h2>
          <p className="text-primary-foreground/80 mb-8 max-w-xl mx-auto">Sign up in 30 seconds. Choose a plan. Start riding tomorrow.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button size="lg" variant="secondary" asChild><Link href="/signup/rider">Sign up as rider</Link></Button>
            <Button size="lg" variant="outline" className="border-primary-foreground text-primary-foreground hover:bg-primary-foreground/10" asChild><Link href="/signup/contractor">Drive for us</Link></Button>
          </div>
        </div>
      </section>

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
                <Link href="/plans" className="block hover:text-foreground">Pricing</Link>
                <Link href="/help" className="block hover:text-foreground">Help & FAQ</Link>
                <Link href="/corporate/onboard" className="block hover:text-foreground">For companies</Link>
              </div>
            </div>
            <div>
              <div className="font-semibold mb-2">Account</div>
              <div className="space-y-1 text-muted-foreground">
                <Link href="/login" className="block hover:text-foreground">Sign in</Link>
                <Link href="/signup/rider" className="block hover:text-foreground">Sign up</Link>
                <Link href="/signup/contractor" className="block hover:text-foreground">Drive for us</Link>
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
          <div className="border-t mt-6 pt-4 text-xs text-muted-foreground">
            © {new Date().getFullYear()} Addis Ride · Powered by Telebirr
          </div>
        </div>
      </footer>
    </div>
  );
}
