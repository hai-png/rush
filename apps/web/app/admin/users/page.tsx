'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DataTable, Badge, Button, Input, type Column } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { useToast } from '@addis/ui';

type UserRow = {
  id: string;
  phone: string;
  name: string;
  role: string;
  isActive: boolean;
  phoneVerified: boolean;
  createdAt: string;
};

const ROLE_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  rider: 'default',
  contractor: 'secondary',
  corporate_admin: 'warning',
  platform_admin: 'destructive',
};

/**
 * Admin user management page. Lists all users with search, allows suspending /
 * reactivating accounts, and changing roles. All actions go through the existing
 * PATCH /api/v1/admin/users/:id endpoint.
 */
export default function AdminUsersPage() {
  const client = useApiClient();
  const qc = useQueryClient();
  const { push } = useToast();
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', search],
    queryFn: async () => (await client.GET('/api/v1/admin/users', { params: { query: { limit: 100, q: search || undefined } } })).data,
  });

  const updateUser = useMutation({
    mutationFn: ({ id, action, role }: { id: string; action: 'suspend' | 'change_role'; role?: string }) =>
      client.PATCH('/api/v1/admin/users/{id}', { params: { path: { id } }, body: { action, role } as any }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); push({ title: 'User updated', variant: 'success' }); },
    onError: () => push({ title: 'Update failed', variant: 'error' }),
  });

  const columns: Column<UserRow>[] = [
    { key: 'phone', header: 'Phone' },
    { key: 'name', header: 'Name' },
    { key: 'role', header: 'Role', render: (u) => <Badge variant={ROLE_VARIANT[u.role] ?? 'default'}>{u.role.replace('_', ' ')}</Badge> },
    {
      key: 'isActive', header: 'Status', render: (u) => (
        <Badge variant={u.isActive ? 'success' : 'destructive'}>{u.isActive ? 'Active' : 'Suspended'}</Badge>
      ),
    },
    {
      key: 'id', header: 'Actions', render: (u) => (
        <div className="flex gap-2">
          {u.isActive ? (
            <Button size="sm" variant="outline" loading={updateUser.isPending} onClick={() => updateUser.mutate({ id: u.id, action: 'suspend' })}>
              Suspend
            </Button>
          ) : (
            <Button size="sm" loading={updateUser.isPending} onClick={() => updateUser.mutate({ id: u.id, action: 'suspend' })}>
              Reactivate
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Users</h1>
        <Input
          placeholder="Search by name or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>
      <DataTable columns={columns} rows={(data ?? []) as UserRow[]} loading={isLoading} />
    </div>
  );
}
