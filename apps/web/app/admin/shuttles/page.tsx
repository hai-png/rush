'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button, DataTable, Input, Label, Badge, type Column } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';

type ShuttleRow = { id: string; plateNumber: string; model: string; vehicleType: string; capacity: number; isActive: boolean };

export default function AdminShuttlesPage() {
  const client = useApiClient();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ plateNumber: '', model: '', year: 2022, vehicleType: 'minibus', capacity: 14 });

  const { data, isLoading } = useQuery({ queryKey: ['admin-shuttles'], queryFn: async () => (await client.GET('/api/v1/admin/shuttles', { params: { query: { limit: 100 } } })).data });
  const create = useMutation({
    mutationFn: () => client.POST('/api/v1/admin/shuttles', { body: form }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-shuttles'] }); setShowForm(false); },
  });
  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => client.PATCH('/api/v1/admin/shuttles/{id}', { params: { path: { id } }, body: { isActive } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-shuttles'] }),
  });

  const columns: Column<ShuttleRow>[] = [
    { key: 'plateNumber', header: 'Plate' }, { key: 'model', header: 'Model' },
    { key: 'vehicleType', header: 'Type' }, { key: 'capacity', header: 'Capacity' },
    { key: 'isActive', header: 'Status', render: (s) => (
      <button
        onClick={() => toggleActive.mutate({ id: s.id, isActive: !s.isActive })}
        aria-label={`${s.isActive ? 'Deactivate' : 'Activate'} shuttle ${s.plateNumber}`}
        title={s.isActive ? 'Deactivate' : 'Activate'}
      >
        <Badge variant={s.isActive ? 'success' : 'secondary'}>{s.isActive ? 'Active' : 'Inactive'}</Badge>
      </button>
    ) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Shuttles</h1>
        <Button size="sm" onClick={() => setShowForm((s) => !s)}><Plus className="h-4 w-4" />New shuttle</Button>
      </div>
      {showForm && (
        <div className="rounded-2xl border border-border p-4 grid sm:grid-cols-2 gap-3">
          <div><Label>Plate number</Label><Input value={form.plateNumber} onChange={(e) => setForm((f) => ({ ...f, plateNumber: e.target.value }))} /></div>
          <div><Label>Model</Label><Input value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} /></div>
          <div><Label>Year</Label><Input type="number" value={form.year} onChange={(e) => setForm((f) => ({ ...f, year: Number(e.target.value) }))} /></div>
          <div><Label>Capacity</Label><Input type="number" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: Number(e.target.value) }))} /></div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button loading={create.isPending} onClick={() => create.mutate()}>Create</Button>
          </div>
        </div>
      )}
      <DataTable columns={columns} rows={(data ?? []) as ShuttleRow[]} loading={isLoading} />
    </div>
  );
}
