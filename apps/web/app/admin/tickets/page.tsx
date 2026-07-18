'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { DataTable, Badge, type Column } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';

type TicketRow = { id: string; subject: string; status: string; priority: string; category: string; createdAt: string };
const STATUS_VARIANT: Record<string, any> = { open: 'warning', in_progress: 'default', resolved: 'success', closed: 'secondary' };

export default function AdminTicketsPage() {
  const client = useApiClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin-tickets'], queryFn: async () => (await client.GET('/api/v1/admin/tickets', { params: { query: { limit: 50 } } })).data });

  const columns: Column<TicketRow>[] = [
    { key: 'subject', header: 'Subject', render: (t) => <Link href={`/admin/tickets/${t.id}`} className="text-accent">{t.subject}</Link> },
    { key: 'category', header: 'Category' },
    { key: 'priority', header: 'Priority' },
    { key: 'status', header: 'Status', render: (t) => <Badge variant={STATUS_VARIANT[t.status]}>{t.status.replace('_', ' ')}</Badge> },
    { key: 'createdAt', header: 'Created', render: (t) => new Date(t.createdAt).toLocaleDateString() },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Support queue</h1>
      <DataTable columns={columns} rows={(data ?? []) as TicketRow[]} loading={isLoading} />
    </div>
  );
}
