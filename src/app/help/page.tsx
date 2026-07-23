import Link from 'next/link';
import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Help & Support · Addis Ride' };

export default async function HelpPage() {
  const faqs = await db.faqArticle.findMany({ where: { isActive: true }, orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Addis Ride</Link>
          <Button asChild variant="ghost"><Link href="/">Home</Link></Button>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
        <h1 className="text-2xl font-bold mb-6">Help & FAQ</h1>
        <div className="space-y-3">
          {faqs.length === 0 ? (
            <Card><CardContent className="py-6 text-center text-muted-foreground">No FAQs yet.</CardContent></Card>
          ) : faqs.map(f => (
            <Card key={f.id}>
              <CardContent className="py-3">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline">{f.category}</Badge>
                  <div className="font-medium">{f.question}</div>
                </div>
                <div className="text-sm text-muted-foreground">{f.answer}</div>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="mt-8 text-center text-sm text-muted-foreground">
          Need more help? <Link href="/tickets/new" className="text-primary hover:underline">Open a ticket →</Link>
        </div>
      </main>
    </div>
  );
}
