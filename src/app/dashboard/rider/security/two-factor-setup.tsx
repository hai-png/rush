'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function TwoFactorSetup({ enabled }: { enabled: boolean }) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [secret, setSecret] = useState('');
  const [otpauth, setOtpauth] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  async function setup() {
    setLoading(true);
    try {
      const res = await api.post<{ secret: string; otpauth: string }>('/api/v1/auth/2fa/setup', { password });
      setSecret(res.secret); setOtpauth(res.otpauth);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  async function enable() {
    setLoading(true);
    try {
      await api.post('/api/v1/auth/2fa/enable', { secret, code });
      toast.success('2FA enabled');
      setOpen(false); router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid code');
    } finally { setLoading(false); }
  }

  async function disable() {
    setLoading(true);
    try {
      await api.post('/api/v1/auth/2fa/disable', { password });
      toast.success('2FA disabled');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  if (enabled) {
    return <Button variant="outline" size="sm" onClick={disable} disabled={loading}>Disable 2FA</Button>;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Enable 2FA</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Set up 2FA</DialogTitle></DialogHeader>
        {!secret ? (
          <div className="space-y-2">
            <Label>Confirm your password</Label>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} />
            <Button onClick={setup} disabled={loading || !password}>{loading ? '…' : 'Generate secret'}</Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm">Add this secret to your authenticator app (Google Authenticator, Authy, etc.):</p>
            <code className="text-xs bg-muted p-2 rounded block break-all">{secret}</code>
            <Label>Enter the 6-digit code from your app</Label>
            <Input value={code} onChange={e => setCode(e.target.value)} maxLength={6} />
            <Button onClick={enable} disabled={loading || code.length !== 6}>{loading ? '…' : 'Verify & enable'}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
