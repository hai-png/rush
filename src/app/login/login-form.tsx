'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api-client';
import { Bus, ChevronLeft } from 'lucide-react';
import { EthiopianPhone } from '@/lib/phone';

const LoginSchema = z.object({
  phone: z.string().refine(EthiopianPhone.isValid, 'Enter a valid Ethiopian phone (+2519XXXXXXXX)'),
  password: z.string().min(1, 'Password is required'),
  code: z.string().length(6).optional().or(z.literal('')),
});

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = LoginSchema.safeParse({ phone, password, code });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]?.toString();
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      const res = await api.post<{ user: { id: string; role: string; phone: string }; requiresTosAcceptance: boolean }>('/api/v1/auth/token', { phone, password, code: code || undefined });
      toast.success('Signed in');
      if (res.requiresTosAcceptance) {
        router.push(next ? `/tos/accept?next=${encodeURIComponent(next)}` : '/tos/accept');
      } else if (next) {
        router.push(next);
      } else {
        routeByRole(res.user.role);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TWO_FACTOR_REQUIRED') {
        toast.error('2FA code required — enter it below and sign in again');
      } else {
        toast.error(err instanceof Error ? err.message : 'Sign-in failed');
      }
    } finally {
      setLoading(false);
    }
  }

  function routeByRole(role: string) {
    switch (role) {
      case 'rider': router.push('/dashboard/rider'); break;
      case 'contractor': router.push('/dashboard/contractor'); break;
      case 'corporate_admin': router.push('/dashboard/corporate'); break;
      case 'platform_admin': router.push('/dashboard/admin'); break;
      default: router.push('/dashboard/rider');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Link href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ChevronLeft className="h-4 w-4" /> Back to home
          </Link>
          <div className="flex items-center gap-2">
            <Bus className="h-6 w-6 text-primary" />
            <CardTitle>Sign in</CardTitle>
          </div>
          <CardDescription>Use a demo account from the home page or your own.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3" autoComplete="on">
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" autoComplete="tel" value={phone} onChange={e => { setPhone(e.target.value); if (errors.phone) setErrors({ ...errors, phone: '' }); }} placeholder="+251911000002" required inputMode="tel" aria-invalid={!!errors.phone} />
              {errors.phone && <p className="text-xs text-destructive mt-1">{errors.phone}</p>}
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={e => { setPassword(e.target.value); if (errors.password) setErrors({ ...errors, password: '' }); }} required aria-invalid={!!errors.password} />
              {errors.password && <p className="text-xs text-destructive mt-1">{errors.password}</p>}
            </div>
            <div>
              <Label htmlFor="code">2FA code (optional)</Label>
              <Input id="code" name="code" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} maxLength={6} placeholder="Only if 2FA is enabled" inputMode="numeric" pattern="[0-9]*" />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
            <div className="text-sm text-muted-foreground text-center pt-2">
              No account? <Link href="/signup/rider" className="text-primary hover:underline">Sign up as rider</Link>
            </div>
            <div className="text-sm text-muted-foreground text-center">
              <Link href="/forgot-password" className="hover:underline">Forgot password?</Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export function LoginForm() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading…</div>}>
      <LoginInner />
    </Suspense>
  );
}
