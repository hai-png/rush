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
import { ChevronLeft, CheckCircle2 } from 'lucide-react';

export function CorporateSignupForm() {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [validation, setValidation] = useState<{ corporateName: string; subsidyPercent: number } | null>(null);
  const [loading, setLoading] = useState(false);

  async function validate() {
    if (!inviteCode) return;
    setLoading(true);
    try {
      const res = await api.post<{ corporateName: string; subsidyPercent: number; maxUses: number; usesCount: number }>('/api/v1/corporate/validate-invite', { inviteCode });
      setValidation({ corporateName: res.corporateName, subsidyPercent: res.subsidyPercent });
      toast.success(`Valid invite for ${res.corporateName} (${res.subsidyPercent}% subsidy)`);
    } catch (err) {
      setValidation(null);
      toast.error(err instanceof Error ? err.message : 'Invalid invite');
    } finally { setLoading(false); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/api/v1/corporate/signup', { inviteCode, employeeId });
      toast.success('Request submitted. Your corporate admin will approve you.');
      router.push('/dashboard/rider');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Link href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ChevronLeft className="h-4 w-4" /> Back to home
          </Link>
          <CardTitle>Join your company's plan</CardTitle>
          <CardDescription>Enter the invite code from your employer.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label htmlFor="code">Invite code</Label>
              <div className="flex gap-2">
                <Input id="code" value={inviteCode} onChange={e => setInviteCode(e.target.value.toUpperCase())} required placeholder="ABCD-EFGH-..." />
                <Button type="button" variant="outline" onClick={validate} disabled={loading || !inviteCode}>Validate</Button>
              </div>
            </div>
            {validation && (
              <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3 flex items-start gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" />
                <div>
                  <div className="font-medium">{validation.corporateName}</div>
                  <div className="text-xs text-muted-foreground">Subsidy: {validation.subsidyPercent}%</div>
                </div>
              </div>
            )}
            <div>
              <Label htmlFor="emp">Your employee ID</Label>
              <Input id="emp" value={employeeId} onChange={e => setEmployeeId(e.target.value)} required placeholder="EMP1234" />
            </div>
            <Button type="submit" disabled={loading || !validation} className="w-full">{loading ? 'Submitting…' : 'Request to join'}</Button>
            <p className="text-xs text-muted-foreground">
              Don't have an invite code? Ask your employer to share it. Want to register a new corporate?{' '}
              <Link href="/corporate/onboard" className="text-primary hover:underline">Onboard your company →</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
