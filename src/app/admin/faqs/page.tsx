import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { FaqForm } from './faq-form';

export const dynamic = 'force-dynamic';

export default async function AdminFaqsPage() {
  await requireRole('platform_admin');
  const faqs = await db.faqArticle.findMany({ orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard/admin" className="text-xl font-bold">Admin · FAQs</Link>
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">FAQ Articles ({faqs.length})</h1>
          <FaqForm />
        </div>
        <Card>
          <CardContent className="py-3 divide-y">
            {faqs.map(f => (
              <div key={f.id} className="py-2 flex justify-between items-start text-sm">
                <div className="flex-1">
                  <div className="font-medium">{f.question}</div>
                  <div className="text-xs text-muted-foreground">{f.category} · sort {f.sortOrder}</div>
                  <div className="text-xs text-muted-foreground mt-1">{f.answer.slice(0, 100)}…</div>
                </div>
                <Badge variant={f.isActive ? 'default' : 'secondary'}>{f.isActive ? 'active' : 'hidden'}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
