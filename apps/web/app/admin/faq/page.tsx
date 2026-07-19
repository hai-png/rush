'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Card, CardContent, Input, Label } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';

export default function AdminFaqPage() {
  const client = useApiClient();
  const qc = useQueryClient();
  const [form, setForm] = useState({ category: 'general', question: '', answer: '' });
  const [showForm, setShowForm] = useState(false);

  const { data } = useQuery({ queryKey: ['admin-faq'], queryFn: async () => (await client.GET('/api/v1/faq')).data });
  const create = useMutation({
    mutationFn: () => client.POST('/api/v1/admin/faq', { body: form }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-faq'] }); setShowForm(false); setForm({ category: 'general', question: '', answer: '' }); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => client.DELETE('/api/v1/admin/faq/{id}', { params: { path: { id } } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-faq'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">FAQ</h1>
        <Button size="sm" onClick={() => setShowForm((s) => !s)}><Plus className="h-4 w-4" />New article</Button>
      </div>
      {showForm && (
        <div className="rounded-2xl border border-border p-4 space-y-3">
          <div><Label>Category</Label>
            <select className="w-full rounded-xl border border-border bg-card p-2" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
              {['billing', 'routes', 'shuttle', 'account', 'corporate', 'general'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div><Label>Question</Label><Input value={form.question} onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))} /></div>
          <div><Label>Answer</Label><textarea className="w-full rounded-xl border border-border bg-card p-3 text-sm" rows={3} value={form.answer} onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))} /></div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button loading={create.isPending} onClick={() => create.mutate()}>Save</Button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {(data ?? []).map((a: any) => (
          <Card key={a.id}><CardContent className="flex items-start justify-between">
            <div><p className="font-medium">{a.question}</p><p className="text-sm text-muted-foreground">{a.answer}</p></div>
            <button
              onClick={() => {
                // Confirm before delete — the previous implementation
                // deleted on a single click with no confirmation dialog.
                if (window.confirm(`Delete FAQ article "${a.question}"?`)) {
                  remove.mutate(a.id);
                }
              }}
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </button>
          </CardContent></Card>
        ))}
      </div>
    </div>
  );
}
