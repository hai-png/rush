'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StatTile, DataTable, Badge, Button, type Column } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';

type Member = { id: string; employeeId: string; approvalStatus: string; ridesUsedThisMonth: number; userName?: string };

export default function CorporateDashboardPage() {
  const client = useApiClient();
  const qc = useQueryClient();
  const { data: corp } = useQuery({ queryKey: ['corp'], queryFn: async () => (await client.GET('/api/v1/corporate')).data });
  const { data: members, isLoading } = useQuery({ queryKey: ['corp-members'], queryFn: async () => (await client.GET('/api/v1/corporate/members')).data });

  const setStatus = useMutation({
    mutationFn: ({ id, approvalStatus }: { id: string; approvalStatus: string }) =>
      client.PATCH('/api/v1/corporate/members/{id}', { params: { path: { id } }, body: { approvalStatus } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['corp-members'] }),
  });

  const columns: Column<Member>[] = [
    { key: 'employeeId', header: 'Employee ID' },
    { key: 'approvalStatus', header: 'Status', render: (m) => <Badge variant={m.approvalStatus === 'approved' ? 'success' : 'warning'}>{m.approvalStatus}</Badge> },
    { key: 'ridesUsedThisMonth', header: 'Rides this month' },
    {
      key: 'id', header: 'Actions',
      render: (m) => m.approvalStatus === 'pending' ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setStatus.mutate({ id: m.id, approvalStatus: 'approved' })}>Approve</Button>
          <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: m.id, approvalStatus: 'rejected' })}>Reject</Button>
        </div>
      ) : null,
    },
  ];

  return (
    <div className="px-5 py-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold">{(corp as any)?.name}</h1>
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Subsidy" value={`${(corp as any)?.subsidyPercent ?? 0}%`} />
        <StatTile label="Monthly allowance" value={`${(corp as any)?.monthlySeatAllowance ?? 0}`} />
        <StatTile label="Members" value={String((members ?? []).length)} />
      </div>
      <DataTable columns={columns} rows={(members ?? []) as Member[]} loading={isLoading} />
    </div>
  );
}
