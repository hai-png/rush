'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
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
            <Label htmlFor="2fa-password">Confirm your password</Label>
            <Input id="2fa-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
            <Button onClick={setup} disabled={loading || !password}>{loading ? '…' : 'Generate secret'}</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password, etc.):</p>
            <div className="flex justify-center p-4 bg-white rounded-lg">
              <QRCodeSVG value={otpauth} size={200} level="M" />
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Can&apos;t scan? Enter the secret manually</summary>
              <code className="text-xs bg-muted p-2 rounded block break-all mt-2">{secret}</code>
            </details>
            <Label htmlFor="2fa-code">Enter the 6-digit code from your app</Label>
            <Input id="2fa-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]*" value={code} onChange={e => setCode(e.target.value)} maxLength={6} />
            <Button onClick={enable} disabled={loading || code.length !== 6}>{loading ? '…' : 'Verify & enable'}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
