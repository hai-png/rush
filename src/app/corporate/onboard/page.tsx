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

export default function CorporateOnboardPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    contactEmail: '',
    contactPhone: '',
    subsidyPercent: 50,
    monthlySeatAllowance: 20,
  });
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post<{ corporate: { id: string; code: string; name: string } }>('/api/v1/corporate/onboard', form);
      toast.success(`Corporate "${res.corporate.name}" created. Code: ${res.corporate.code}`);
      router.push('/dashboard/corporate');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <Link href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ChevronLeft className="h-4 w-4" /> Back to home
          </Link>
          <CardTitle>Onboard your company</CardTitle>
          <CardDescription>Register a corporate account to subsidize your employees' shuttle rides.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label htmlFor="name">Company name</Label>
              <Input id="name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required minLength={2} />
            </div>
            <div>
              <Label htmlFor="email">Contact email</Label>
              <Input id="email" type="email" value={form.contactEmail} onChange={e => setForm({ ...form, contactEmail: e.target.value })} required />
            </div>
            <div>
              <Label htmlFor="phone">Contact phone</Label>
              <Input id="phone" value={form.contactPhone} onChange={e => setForm({ ...form, contactPhone: e.target.value })} required placeholder="+2519XXXXXXXX" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="subsidy">Subsidy percent (%)</Label>
                <Input id="subsidy" type="number" min={0} max={100} value={form.subsidyPercent} onChange={e => setForm({ ...form, subsidyPercent: Number(e.target.value) })} required />
              </div>
              <div>
                <Label htmlFor="allowance">Monthly seat allowance</Label>
                <Input id="allowance" type="number" min={1} max={1000} value={form.monthlySeatAllowance} onChange={e => setForm({ ...form, monthlySeatAllowance: Number(e.target.value) })} required />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              You'll be promoted to <code>corporate_admin</code> and given an invite code to share with your employees.
<<<<<<< HEAD
              They sign up as riders, enter the code, and you approve them.
=======
>>>>>>> main
            </p>
            <Button type="submit" disabled={loading} className="w-full">{loading ? 'Creating…' : 'Onboard company'}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
