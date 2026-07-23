'use client';
import { useRouter } from 'next/navigation';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

// FE-058: an admin must not be able to suspend, reactivate, or change the
// role of their own account — that's how an admin locks themselves out or
// accidentally degrades their own privileges. The current user's id is
// passed in as `currentUserId` and compared against the row's `userId`.
// (Server-side enforcement is the backend agent's responsibility; this is
// the client-side guard.)
export function UserActions({
  userId,
  currentRole,
  isActive,
  currentUserId,
}: {
  userId: string;
  currentRole: string;
  isActive: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const self = userId === currentUserId;
  const selfHint = "You can't modify your own account";

  const [loading, setLoading] = useState<'suspend' | 'reactivate' | 'role' | 'impersonate' | null>(null);
  const [role, setRole] = useState(currentRole);
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');

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

  // impersonation with a UI button + confirmation dialog + 2FA code field.
  async function impersonate() {
    setLoading('impersonate');
    try {
      const res = await api.post<{ accessToken: string; targetUser: { id: string; phone: string; role: string }; expiresAt: string }>(
        `/api/v1/admin/users/${userId}/impersonate`,
        { code: twoFactorCode },
      );
      // Store the impersonation token and redirect to the target user's dashboard.
      document.cookie = `addis-session=${res.accessToken}; path=/; max-age=3600; samesite=lax`;
      toast.success(`Impersonating ${res.targetUser.phone} (expires in 1 hour)`);
      setImpersonateOpen(false);
      setTwoFactorCode('');
      // Redirect based on target user's role.
      const dash = res.targetUser.role === 'rider' ? '/dashboard/rider'
        : res.targetUser.role === 'contractor' ? '/dashboard/contractor'
        : res.targetUser.role === 'corporate_admin' ? '/dashboard/corporate'
        : '/dashboard/admin';
      window.location.href = dash;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Impersonation failed');
    } finally { setLoading(null); }
  }

  return (
    <div className="flex items-center gap-1">
      <Select value={role} onValueChange={setRole} disabled={loading !== null || self}>
        <SelectTrigger className="h-8 w-32 text-xs" title={self ? selfHint : undefined}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="rider">rider</SelectItem>
          <SelectItem value="contractor">contractor</SelectItem>
          <SelectItem value="corporate_admin">corporate_admin</SelectItem>
          <SelectItem value="platform_admin">platform_admin</SelectItem>
        </SelectContent>
      </Select>
      {role !== currentRole && (
        <Button
          size="sm"
          variant="default"
          className="h-8"
          disabled={loading !== null || self}
          title={self ? selfHint : undefined}
          onClick={() => act('change_role')}
        >
          {loading === 'role' ? '…' : 'Set'}
        </Button>
      )}
      {isActive ? (
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={loading !== null || self}
          title={self ? selfHint : undefined}
          onClick={() => act('suspend')}
        >
          {loading === 'suspend' ? '…' : 'Suspend'}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={loading !== null || self}
          title={self ? selfHint : undefined}
          onClick={() => act('reactivate')}
        >
          {loading === 'reactivate' ? '…' : 'Reactivate'}
        </Button>
      )}
      {/* H5 FIX: impersonation button with confirmation dialog + 2FA code field */}
      <Dialog open={impersonateOpen} onOpenChange={setImpersonateOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={loading !== null || currentRole === 'platform_admin'}>
            Impersonate
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Impersonate user</DialogTitle>
            <DialogDescription>
              You will be signed in as this user for 1 hour. Your 2FA code is required.
              All actions will be audit-logged with your admin ID.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="impersonate-2fa">Your 2FA code</Label>
              <Input
                id="impersonate-2fa"
                value={twoFactorCode}
                onChange={e => setTwoFactorCode(e.target.value)}
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </div>
            <Button
              onClick={impersonate}
              disabled={loading === 'impersonate' || twoFactorCode.length !== 6}
              className="w-full"
            >
              {loading === 'impersonate' ? 'Impersonating…' : 'Impersonate (1 hour)'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
