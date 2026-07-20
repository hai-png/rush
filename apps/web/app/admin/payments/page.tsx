'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DataTable, Badge, Button, type Column } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { useFormatMoney } from '@addis/i18n';

type PaymentRow = { id: string; riderId: string; amount: string; method: string; status: string; reference: string; createdAt: string };
const STATUS_VARIANT: Record<string, any> = { completed: 'success', pending: 'warning', failed: 'destructive', refunded: 'secondary', partially_refunded: 'secondary' };

export default function AdminPaymentsPage() {
  const client = useApiClient();
  const qc = useQueryClient();
  const money = useFormatMoney();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const { data, isLoading } = useQuery({
    queryKey: ['admin-payments', statusFilter],
    queryFn: async () => (await client.GET('/api/v1/admin/payments', { params: { query: { limit: 50, status: statusFilter || undefined } } })).data,
  });
  const verifyCbe = useMutation({

    mutationFn: (input: { id: string; verifiedAmount: string; reason: string }) =>
      client.POST('/api/v1/admin/payments/{id}/verify', {
        params: { path: { id: input.id } },
        headers: { 'Idempotency-Key': `cbe-verify:${input.id}` },
        body: { verifiedAmount: input.verifiedAmount, reason: input.reason },
      } as any),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-payments'] }),
  });

  const columns: Column<PaymentRow>[] = [
    { key: 'reference', header: 'Reference' },
    { key: 'amount', header: 'Amount', render: (p) => money(p.amount) },
    { key: 'method', header: 'Method', render: (p) => <Badge variant="secondary">{p.method}</Badge> },
    { key: 'status', header: 'Status', render: (p) => <Badge variant={STATUS_VARIANT[p.status]}>{p.status}</Badge> },
    { key: 'createdAt', header: 'Date', render: (p) => new Date(p.createdAt).toLocaleDateString() },
    { key: 'id', header: 'Actions', render: (p) => p.method === 'cbe' && p.status === 'pending'
      ? <Button size="sm"
          loading={verifyCbe.isPending && verifyCbe.variables?.id === p.id}
          onClick={() => {

            const verifiedAmount = window.prompt(
              `Manually verify payment ${p.reference}\n\nExpected: ETB ${p.amount}\n\nEnter the verified amount (ETB) the bank confirmed:`,
              p.amount,
            );
            if (verifiedAmount === null) return;
            const reason = window.prompt('Reason (required, audited):', 'Manual bank transfer confirmation');
            if (!reason) return;
            verifyCbe.mutate({ id: p.id, verifiedAmount, reason });
          }}>
          Verify manually
        </Button> : null },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Payments</h1>
        <select className="rounded-xl border border-border bg-card px-3 py-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {['pending', 'completed', 'failed', 'refunded', 'partially_refunded'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <DataTable columns={columns} rows={(data ?? []) as PaymentRow[]} loading={isLoading} />
    </div>
  );
}
