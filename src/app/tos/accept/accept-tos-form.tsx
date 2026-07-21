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
      await api.post('/api/v1/tos/accept');
      toast.success('Terms accepted');
      router.push('/dashboard/rider');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  return <Button onClick={accept} disabled={loading} className="w-full">{loading ? 'Accepting…' : 'Accept and continue'}</Button>;
}
