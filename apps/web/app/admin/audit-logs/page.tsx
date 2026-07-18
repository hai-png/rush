'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DataTable, Input, type Column } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';

type AuditRow = { id: string; actorId: string | null; action: string; entityType: string; entityId: string | null; createdAt: string };

export default function AuditLogsPage() {
  const client = useApiClient();
  const [filters, setFilters] = useState({ action: '', entityType: '' });
  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: async () => (await client.GET('/api/v1/admin/audit-logs', { params: { query: filters } })).data,
  });

  const columns: Column<AuditRow>[] = [
    { key: 'createdAt', header: 'When', render: (r) => new Date(r.createdAt).toLocaleString() },
    { key: 'action', header: 'Action' },
    { key: 'entityType', header: 'Entity' },
    { key: 'entityId', header: 'Entity ID' },
    { key: 'actorId', header: 'Actor' },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Audit log</h1>
      <div className="flex gap-3">
        <Input placeholder="Filter by action…" value={filters.action} onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))} />
        <Input placeholder="Filter by entity type…" value={filters.entityType} onChange={(e) => setFilters((f) => ({ ...f, entityType: e.target.value }))} />
      </div>
      <DataTable columns={columns} rows={(data ?? []) as AuditRow[]} loading={isLoading} />
    </div>
  );
}
