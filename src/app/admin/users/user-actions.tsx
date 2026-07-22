'use client';
import { useRouter } from 'next/navigation';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function UserActions({ userId, currentRole, isActive }: { userId: string; currentRole: string; isActive: boolean }) {
  const router = useRouter();

  const [loading, setLoading] = useState<'suspend' | 'reactivate' | 'role' | null>(null);
  const [role, setRole] = useState(currentRole);

  async function act(action: 'suspend' | 'reactivate' | 'change_role') {
    setLoading(action === 'change_role' ? 'role' : action);
    try {
      const body: any = { action };
      if (action === 'change_role') body.role = role;
      await api.patch(`/api/v1/admin/users/${userId}`, body);
      toast.success(`User ${action === 'change_role' ? 'role updated' : action === 'suspend' ? 'suspended' : 'reactivated'}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(null); }
  }

  return (
    <div className="flex items-center gap-1">
      <Select value={role} onValueChange={setRole} disabled={loading !== null}>
        <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="rider">rider</SelectItem>
          <SelectItem value="contractor">contractor</SelectItem>
          <SelectItem value="corporate_admin">corporate_admin</SelectItem>
          <SelectItem value="platform_admin">platform_admin</SelectItem>
        </SelectContent>
      </Select>
      {role !== currentRole && (
        <Button size="sm" variant="default" className="h-8" disabled={loading !== null} onClick={() => act('change_role')}>
          {loading === 'role' ? '…' : 'Set'}
        </Button>
      )}
      {isActive ? (
        <Button size="sm" variant="outline" className="h-8" disabled={loading !== null} onClick={() => act('suspend')}>
          {loading === 'suspend' ? '…' : 'Suspend'}
        </Button>
      ) : (
        <Button size="sm" variant="outline" className="h-8" disabled={loading !== null} onClick={() => act('reactivate')}>
          {loading === 'reactivate' ? '…' : 'Reactivate'}
        </Button>
      )}
    </div>
  );
}
