'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare, Plus } from 'lucide-react';
import { Badge, Button, EmptyState, Card, CardContent } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';

const STATUS_VARIANT: Record<string, any> = { open: 'warning', in_progress: 'default', resolved: 'success', closed: 'secondary' };

export default function TicketsPage() {
  const client = useApiClient();
  const { data, isLoading } = useQuery({
    queryKey: ['tickets'],
    queryFn: async () => (await client.GET('/api/v1/tickets')).data,
  });

  return (
    <div className="px-5 py-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Support tickets</h1>
        <Link href="/tickets/new"><Button size="sm"><Plus className="h-4 w-4" />New ticket</Button></Link>
      </div>

      {!isLoading && !data?.length && (
        <EmptyState icon={MessageSquare} title="No tickets yet" description="Need help? Create a ticket and our team will respond." actionLabel="New ticket" onAction={() => (window.location.href = '/tickets/new')} />
      )}

      <div className="space-y-2">
        {(data ?? []).map((t: any) => (
          <Link key={t.id} href={`/tickets/${t.id}`}>
            <Card className="hover:border-primary transition-colors">
              <CardContent className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{t.subject}</p>
                  <p className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleDateString()}</p>
                </div>
                <Badge variant={STATUS_VARIANT[t.status]}>{t.status.replace('_', ' ')}</Badge>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
