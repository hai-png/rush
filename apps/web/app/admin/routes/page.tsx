'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button, DataTable, Input, Label, FieldError, Badge, type Column } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { useToast } from '@addis/ui';
import { CreateRouteInput } from '@addis/api/modules/catalog/types';

type RouteRow = { id: string; name: string; origin: string; destination: string; fare: string; isActive: boolean };

export default function AdminRoutesPage() {
  const client = useApiClient();
  const qc = useQueryClient();
  const { push } = useToast();
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['admin-routes'], queryFn: async () => (await client.GET('/api/v1/routes', { params: { query: { limit: 100 } } })).data });

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(CreateRouteInput) });

  const create = useMutation({
    mutationFn: (body: any) => client.POST('/api/v1/admin/routes', { body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-routes'] }); setShowForm(false); reset(); push({ title: 'Route created', variant: 'success' }); },
    onError: () => push({ title: 'Could not create route', variant: 'error' }),
  });
  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => client.PATCH('/api/v1/admin/routes/{id}', { params: { path: { id } }, body: { isActive } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-routes'] }),
  });

  const columns: Column<RouteRow>[] = [
    { key: 'name', header: 'Name' },
    { key: 'origin', header: 'Origin' },
    { key: 'destination', header: 'Destination' },
    { key: 'fare', header: 'Fare (ETB)' },
    { key: 'isActive', header: 'Status', render: (r) => (
      <button
        onClick={() => toggleActive.mutate({ id: r.id, isActive: !r.isActive })}
        aria-label={`${r.isActive ? 'Deactivate' : 'Activate'} route ${r.name}`}
        title={r.isActive ? 'Deactivate' : 'Activate'}
      >
        <Badge variant={r.isActive ? 'success' : 'secondary'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>
      </button>
    ) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Routes</h1>
        <Button size="sm" onClick={() => setShowForm((s) => !s)}><Plus className="h-4 w-4" />New route</Button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit((d) => create.mutate(d))} className="rounded-2xl border border-border p-4 grid sm:grid-cols-2 gap-3">
          <div><Label>Name</Label><Input {...register('name')} aria-invalid={!!errors.name} /><FieldError>{errors.name?.message as string}</FieldError></div>
          <div><Label>Fare (ETB)</Label><Input {...register('fare')} aria-invalid={!!errors.fare} /><FieldError>{errors.fare?.message as string}</FieldError></div>
          <div><Label>Origin</Label><Input {...register('origin')} /></div>
          <div><Label>Destination</Label><Input {...register('destination')} /></div>
          <div><Label>Distance (km)</Label><Input type="number" step="0.1" {...register('distanceKm', { valueAsNumber: true })} /></div>
          <div><Label>Duration (min)</Label><Input type="number" {...register('durationMin', { valueAsNumber: true })} /></div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" loading={isSubmitting}>Create</Button>
          </div>
        </form>
      )}

      <DataTable columns={columns} rows={(data ?? []) as RouteRow[]} loading={isLoading} />
    </div>
  );
}
