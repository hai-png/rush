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

export default function RiderSignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', phone: '', password: '', homeArea: '', workArea: '' });
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/api/v1/auth/register', { kind: 'rider', ...form });
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
              <Input id="name" name="name" autoComplete="name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required minLength={2} />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" autoComplete="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+2519XXXXXXXX" required inputMode="tel" />
            </div>
            <div>
              <Label htmlFor="password">Password (min 10 chars)</Label>
              <Input id="password" name="password" type="password" autoComplete="new-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required minLength={10} />
            </div>
            <div>
              <Label htmlFor="homeArea">Home area</Label>
              <Input id="homeArea" name="homeArea" autoComplete="address-level2" value={form.homeArea} onChange={e => setForm({ ...form, homeArea: e.target.value })} placeholder="Bole" required />
            </div>
            <div>
              <Label htmlFor="workArea">Work area</Label>
              <Input id="workArea" name="workArea" autoComplete="address-level2" value={form.workArea} onChange={e => setForm({ ...form, workArea: e.target.value })} placeholder="Merkato" required />
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
