'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function AcceptTosForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function accept() {
    setLoading(true);
    try {
      // Fetch /auth/me to get the user's role, then redirect to the
      // role-specific dashboard.
      const me = await api.get<{ role: string }>('/api/v1/auth/me');
      await api.post('/api/v1/tos/accept');
      toast.success('Terms accepted');
      const route = roleDashboard(me.role);
      router.push(route);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  function roleDashboard(role: string): string {
    switch (role) {
      case 'contractor': return '/dashboard/contractor';
      case 'corporate_admin': return '/dashboard/corporate';
      case 'platform_admin': return '/dashboard/admin';
      case 'rider':
      default: return '/dashboard/rider';
    }
  }

  return <Button onClick={accept} disabled={loading} className="w-full">{loading ? 'Accepting…' : 'Accept and continue'}</Button>;
}
