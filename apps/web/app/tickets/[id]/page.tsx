'use client';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Input } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const client = useApiClient();
  const qc = useQueryClient();
  const [body, setBody] = useState('');

  const { data: ticket } = useQuery({ queryKey: ['ticket', id], queryFn: async () => (await client.GET('/api/v1/tickets/{id}', { params: { path: { id } } })).data });
  const { data: messages } = useQuery({
    queryKey: ['ticket-messages', id],
    queryFn: async () => (await client.GET('/api/v1/tickets/{id}/messages', { params: { path: { id } } })).data,
    refetchInterval: 15_000, // polling per §15
  });

  const reply = useMutation({
    mutationFn: async () => client.POST('/api/v1/tickets/{id}/messages', { params: { path: { id } }, body: { body } }),
    onSuccess: () => { setBody(''); qc.invalidateQueries({ queryKey: ['ticket-messages', id] }); },
  });

  return (
    <div className="px-5 py-6 max-w-2xl mx-auto flex flex-col h-[calc(100vh-2rem)]">
      <h1 className="text-lg font-semibold mb-1">{(ticket as any)?.subject}</h1>
      <p className="text-sm text-muted-foreground mb-4">{(ticket as any)?.body}</p>

      <div className="flex-1 overflow-y-auto space-y-3">
        {(messages ?? []).map((m: any) => (
          <div key={m.id} className={`max-w-[80%] rounded-2xl p-3 text-sm ${m.isStaff ? 'bg-secondary self-start' : 'bg-primary/10 self-end ml-auto'}`}>
            {m.body}
          </div>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); reply.mutate(); }} className="flex gap-2 mt-4">
        <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Type a message…" aria-label="Reply" />
        <Button type="submit" loading={reply.isPending}>Send</Button>
      </form>
    </div>
  );
}
