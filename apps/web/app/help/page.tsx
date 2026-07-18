import { getServerApiClient } from '@/lib/sdk';

export default async function HelpPage() {
  const client = await getServerApiClient();
  const { data } = await client.GET('/api/v1/faq');
  const byCategory = Object.groupBy(data ?? [], (a: any) => a.category);

  return (
    <div className="max-w-2xl mx-auto px-6 py-16 space-y-8">
      <h1 className="text-2xl font-semibold">Help Center</h1>
      {Object.entries(byCategory).map(([cat, items]) => (
        <section key={cat}>
          <h2 className="font-semibold capitalize mb-3">{cat}</h2>
          <div className="space-y-3">
            {(items as any[]).map((a) => (
              <details key={a.id} className="rounded-xl border border-border p-4">
                <summary className="font-medium cursor-pointer">{a.question}</summary>
                <p className="text-sm text-muted-foreground mt-2">{a.answer}</p>
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
