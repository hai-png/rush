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
    // FIX (WEB-005): Manual payment verification is the highest-fraud-risk
    // admin action in the system. The previous implementation had:
    //   1. No confirmation dialog — a single misclick marked a payment
    //      completed with no external confirmation.
    //   2. No idempotency key — double-clicking "Verify manually" fired
    //      two POSTs. If the API didn't dedupe, the same bank transfer
    //      could be credited twice (double-activation, refund eligibility,
    //      revenue inflation).
    //   3. No per-row loading state — verifyCbe.isPending was true for
    //      ALL rows simultaneously, so double-clicking one row disabled
    //      the buttons on every other row.
    // The idempotency key is `cbe-verify:${id}` — stable per payment, so
    // a retry (network blip, double-click) returns the cached response
    // instead of re-verifying. The per-row loading state keys off
    // verifyCbe.variables === p.id.
    // The mutation input includes the verifiedAmount (the actual amount
    // the admin confirmed was received) and a reason — both required by
    // the server. The server compares verifiedAmount to payment.amount
    // and refuses to mark completed on mismatch (defends against typos
    // and underpayment fraud).
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
            // FIX (WEB-005): prompt for the verified amount + reason so the
            // server's amount-mismatch check has real data to compare
            // against. A simple confirm() dialog would send an empty
            // verifiedAmount, which the server rejects as AMOUNT_MISMATCH
            // (409) — correct behavior, but bad UX. The prompt prefills
            // with the expected amount so the admin can confirm by
            // pressing Enter, or correct it if the bank transfer was for
            // a different amount.
            const verifiedAmount = window.prompt(
              `Manually verify payment ${p.reference}\n\nExpected: ETB ${p.amount}\n\nEnter the verified amount (ETB) the bank confirmed:`,
              p.amount,
            );
            if (verifiedAmount === null) return;  // admin cancelled
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
