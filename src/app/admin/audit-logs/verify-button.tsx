'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function VerifyChainButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function verify() {
    setLoading(true);
    try {
      const r = await api.post<{ ok: boolean; brokenAt?: string }>('/api/v1/admin/audit/verify');
      setResult(r);
      if (r.ok) toast.success('Audit chain is intact');
      else toast.error(`Chain broken at ${r.brokenAt}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  return (
    <div className="flex items-center gap-2">
      {result && <span className="text-sm">{result.ok ? '✓ intact' : '✗ broken'}</span>}
      <Button onClick={verify} disabled={loading} variant="outline" size="sm">{loading ? 'Verifying…' : 'Verify chain'}</Button>
    </div>
  );
}
