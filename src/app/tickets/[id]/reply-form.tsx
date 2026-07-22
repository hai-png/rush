'use client';
import { useRouter } from 'next/navigation';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function ReplyForm({ ticketId }: { ticketId: string }) {
  const router = useRouter();

  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);

  async function send() {
    if (!body.trim()) return;
    setLoading(true);
    try {
      await api.post(`/api/v1/tickets/${ticketId}/messages`, { body });
      setBody('');
      toast.success('Reply sent');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-2">
      <Textarea value={body} onChange={e => setBody(e.target.value)} rows={3} placeholder="Reply…" />
      <Button onClick={send} disabled={loading || !body.trim()}>{loading ? 'Sending…' : 'Send reply'}</Button>
    </div>
  );
}
