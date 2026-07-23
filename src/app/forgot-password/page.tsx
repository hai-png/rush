'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';
import { ChevronLeft } from 'lucide-react';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<'send' | 'verify'>('send');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/api/v1/auth/password/reset', { phone });
      // FE-045: don't leak dev OTP details in the user-facing toast. The dev
      // code is only logged server-side (and only when OTP_DEBUG=1).
      toast.success('If that phone is registered, a reset code has been sent.');
      setStep('verify');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/api/v1/auth/password/reset/confirm', { phone, code, newPassword });
      toast.success('Password reset — sign in');
      router.push('/login');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Link href="/login" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ChevronLeft className="h-4 w-4" /> Back to sign in
          </Link>
          <CardTitle>Reset password</CardTitle>
          <CardDescription>{step === 'send' ? 'Enter your phone to receive a code.' : 'Enter the code and your new password.'}</CardDescription>
        </CardHeader>
        <CardContent>
          {step === 'send' ? (
            <form onSubmit={send} className="space-y-3">
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" value={phone} onChange={e => setPhone(e.target.value)} required />
              </div>
              <Button type="submit" disabled={loading} className="w-full">Send code</Button>
            </form>
          ) : (
            <form onSubmit={verify} className="space-y-3">
              <div>
                <Label htmlFor="code">Code</Label>
                <Input id="code" value={code} onChange={e => setCode(e.target.value)} maxLength={6} required />
              </div>
              <div>
                <Label htmlFor="newpw">New password (min 10 chars)</Label>
                <Input id="newpw" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={10} />
              </div>
              <Button type="submit" disabled={loading} className="w-full">Reset</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
