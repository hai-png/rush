'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';
import { Plus } from 'lucide-react';

export function FaqForm() {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ category: 'general', question: '', answer: '', sortOrder: 0 });

  async function submit() {
    setLoading(true);
    try {
      await api.post('/api/v1/admin/faqs', form);
      toast.success('FAQ created');
      setOpen(false); router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> New FAQ</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create FAQ article</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label>Category</Label>
            <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['general', 'billing', 'routes', 'shuttle', 'account', 'corporate'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Question</Label><Input value={form.question} onChange={e => setForm({ ...form, question: e.target.value })} /></div>
          <div><Label>Answer</Label><Textarea value={form.answer} onChange={e => setForm({ ...form, answer: e.target.value })} rows={4} /></div>
          <div><Label>Sort order</Label><Input type="number" value={form.sortOrder} onChange={e => setForm({ ...form, sortOrder: Number(e.target.value) })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={loading || !form.question || !form.answer}>{loading ? 'Creating…' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
