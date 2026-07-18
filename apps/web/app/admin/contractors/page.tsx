'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, DataTable, Badge, type Column } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { useToast } from '@addis/ui';

type Contractor = { id: string; licenseNumber: string; verificationStatus: string; experienceYears: number };

export default function AdminContractorsPage() {
  const client = useApiClient();
  const qc = useQueryClient();
  const { push } = useToast();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['admin-contractors-pending'], queryFn: async () => (await client.GET('/api/v1/admin/contractors/pending')).data });

  const verify = useMutation({
    mutationFn: (id: string) => client.POST('/api/v1/admin/contractors/{id}/verify', { params: { path: { id } } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-contractors-pending'] }); push({ title: 'Contractor verified', variant: 'success' }); },
  });
  const reject = useMutation({
    mutationFn: () => client.POST('/api/v1/admin/contractors/{id}/reject', { params: { path: { id: rejectingId! } }, body: { reason } }),
    onSuccess: () => { setRejectingId(null); setReason(''); qc.invalidateQueries({ queryKey: ['admin-contractors-pending'] }); },
  });

  const columns: Column<Contractor>[] = [
    { key: 'licenseNumber', header: 'License #' },
    { key: 'experienceYears', header: 'Experience (yrs)' },
    { key: 'verificationStatus', header: 'Status', render: (c) => <Badge variant="warning">{c.verificationStatus}</Badge> },
    {
      key: 'id', header: 'Actions',
      render: (c) => (
        <div className="flex gap-2">
          <Button size="sm" loading={verify.isPending} onClick={() => verify.mutate(c.id)}>Verify</Button>
          <Button size="sm" variant="outline" onClick={() => setRejectingId(c.id)}>Reject</Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Pending contractor verifications</h1>
      <DataTable columns={columns} rows={(data ?? []) as Contractor[]} loading={isLoading} />

      {rejectingId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-6" role="dialog" aria-modal>
          <div className="bg-card rounded-2xl p-6 w-full max-w-sm space-y-3">
            <p className="font-semibold">Reject contractor</p>
            <textarea className="w-full rounded-xl border border-border p-3 text-sm" rows={3} placeholder="Reason for rejection…" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRejectingId(null)}>Cancel</Button>
              <Button variant="destructive" disabled={reason.length < 3} loading={reject.isPending} onClick={() => reject.mutate()}>Reject</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
