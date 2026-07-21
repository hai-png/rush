'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function ChangePasswordForm() {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    try {
      await api.post('/api/v1/auth/change-password', { oldPassword: oldPw, newPassword: newPw });
      toast.success('Password changed — all sessions revoked');
      setOldPw(''); setNewPw('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-2">
      <div>
        <Label>Current password</Label>
        <Input type="password" value={oldPw} onChange={e => setOldPw(e.target.value)} />
      </div>
      <div>
        <Label>New password (min 10 chars)</Label>
        <Input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} />
      </div>
      <Button onClick={submit} disabled={loading || !oldPw || newPw.length < 10}>{loading ? 'Changing…' : 'Change password'}</Button>
    </div>
  );
}
