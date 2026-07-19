'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { Button, Input, Label, FieldError } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { useToast } from '@addis/ui';

const Schema = z.object({
  subject: z.string().min(3, 'Subject must be at least 3 characters'),
  body: z.string().min(1, 'Please describe your issue'),
  category: z.enum(['general', 'billing', 'route', 'shuttle', 'account', 'corporate', 'other']).default('general'),
});
type FormValues = z.infer<typeof Schema>;

const CATEGORIES: { value: FormValues['category']; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'billing', label: 'Billing / Payments' },
  { value: 'route', label: 'Route' },
  { value: 'shuttle', label: 'Shuttle / Driver' },
  { value: 'account', label: 'Account' },
  { value: 'corporate', label: 'Corporate subsidy' },
  { value: 'other', label: 'Other' },
];

export default function NewTicketPage() {
  const router = useRouter();
  const client = useApiClient();
  const { push } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: { subject: '', body: '', category: 'general' },
  });

  const onSubmit = async (data: FormValues) => {
    setSubmitting(true);
    const { data: res, error } = await client.POST('/api/v1/tickets', { body: data });
    setSubmitting(false);
    if (error || !res) {
      push({ title: 'Could not create ticket', variant: 'error' });
      return;
    }
    push({ title: 'Ticket created', variant: 'success' });
    router.push(`/tickets/${(res as any).data?.id ?? ''}`);
  };

  return (
    <div className="px-5 py-6 max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-6">New support ticket</h1>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <div>
          <Label htmlFor="subject">Subject</Label>
          <Input id="subject" {...register('subject')} aria-invalid={!!errors.subject} />
          <FieldError>{errors.subject?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="category">Category</Label>
          <select
            id="category"
            className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
            {...register('category')}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <FieldError>{errors.category?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="body">How can we help?</Label>
          <textarea
            id="body"
            rows={5}
            className="w-full rounded-xl border border-border bg-card p-3 text-sm"
            {...register('body')}
            aria-invalid={!!errors.body}
          />
          <FieldError>{errors.body?.message}</FieldError>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Submit ticket
          </Button>
        </div>
      </form>
    </div>
  );
}
