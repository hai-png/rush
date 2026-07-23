'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';
import { ChevronLeft } from 'lucide-react';
import { EthiopianPhone } from '@/lib/phone';

// FE-02: client-side validation mirrors the server schema so users get
// inline feedback before the request is sent.
const SignupSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z.string().refine(EthiopianPhone.isValid, 'Enter a valid Ethiopian phone (+2519XXXXXXXX)'),
  password: z.string().min(10, 'Password must be at least 10 characters').max(128, 'Password must be at most 128 characters'),
  homeArea: z.string().min(1, 'Home area is required'),
  workArea: z.string().min(1, 'Work area is required'),
});

export default function RiderSignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', phone: '', password: '', homeArea: '', workArea: '' });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // FE-02: validate before submitting — show inline field errors.
    const parsed = SignupSchema.safeParse(form);
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
      await api.post('/api/v1/auth/register', { kind: 'rider', ...form });
      // Auto-login after signup
      await api.post('/api/v1/auth/token', { phone: form.phone, password: form.password });
      toast.success('Account created');
      router.push('/tos/accept');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Link href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ChevronLeft className="h-4 w-4" /> Back to home
          </Link>
          <CardTitle>Sign up as rider</CardTitle>
          <CardDescription>Subscribe to a shuttle plan and ride daily.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3" autoComplete="on">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" autoComplete="name" value={form.name} onChange={e => { setForm({ ...form, name: e.target.value }); if (errors.name) setErrors({ ...errors, name: '' }); }} required minLength={2} aria-invalid={!!errors.name} />
              {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" autoComplete="tel" value={form.phone} onChange={e => { setForm({ ...form, phone: e.target.value }); if (errors.phone) setErrors({ ...errors, phone: '' }); }} placeholder="+2519XXXXXXXX" required inputMode="tel" aria-invalid={!!errors.phone} />
              {errors.phone && <p className="text-xs text-destructive mt-1">{errors.phone}</p>}
            </div>
            <div>
              <Label htmlFor="password">Password (min 10 chars)</Label>
              <Input id="password" name="password" type="password" autoComplete="new-password" value={form.password} onChange={e => { setForm({ ...form, password: e.target.value }); if (errors.password) setErrors({ ...errors, password: '' }); }} required minLength={10} maxLength={128} aria-invalid={!!errors.password} />
              {errors.password && <p className="text-xs text-destructive mt-1">{errors.password}</p>}
            </div>
            <div>
              <Label htmlFor="homeArea">Home area</Label>
              <Input id="homeArea" name="homeArea" autoComplete="address-level2" value={form.homeArea} onChange={e => { setForm({ ...form, homeArea: e.target.value }); if (errors.homeArea) setErrors({ ...errors, homeArea: '' }); }} placeholder="Bole" required aria-invalid={!!errors.homeArea} />
              {errors.homeArea && <p className="text-xs text-destructive mt-1">{errors.homeArea}</p>}
            </div>
            <div>
              <Label htmlFor="workArea">Work area</Label>
              <Input id="workArea" name="workArea" autoComplete="address-level2" value={form.workArea} onChange={e => { setForm({ ...form, workArea: e.target.value }); if (errors.workArea) setErrors({ ...errors, workArea: '' }); }} placeholder="Merkato" required aria-invalid={!!errors.workArea} />
              {errors.workArea && <p className="text-xs text-destructive mt-1">{errors.workArea}</p>}
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Creating…' : 'Create account'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
