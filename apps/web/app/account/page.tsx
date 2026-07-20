'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Button, Input, Label, LocaleSwitcher } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { useTheme } from '../theme-provider';
import { useToast } from '@addis/ui';

// FE-007: explicit Zod schema for the account form. The previous code used
// useForm() with no schema, dynamically registering fields — risky if the
// `me` response contained extra fields (phone, role) that the user could
// accidentally submit. The server uses .strict() so it would reject them,
// but the client now sends only the three editable fields.
const AccountSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  homeArea: z.string().min(2).max(200).optional(),
  workArea: z.string().min(2).max(200).optional(),
}).strict();
type AccountForm = z.infer<typeof AccountSchema>;

export default function AccountPage() {
  const client = useApiClient();
  const { theme, toggle } = useTheme();
  const { push } = useToast();
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: async () => (await client.GET('/api/v1/account')).data });
  const { register, handleSubmit, reset, formState: { isSubmitting, isDirty } } = useForm<AccountForm>({
    resolver: zodResolver(AccountSchema),
  });

  useEffect(() => {
    if (me) {
      // Only populate the editable fields — don't copy phone/role/etc.
      const editable = (me as any)?.data ?? me;
      reset({ name: editable?.name, homeArea: editable?.profile?.homeArea, workArea: editable?.profile?.workArea });
    }
  }, [me, reset]);

  const onSubmit = async (data: AccountForm) => {
    const { error } = await client.PATCH('/api/v1/account', { body: data });
    push(error ? { title: 'Update failed', variant: 'error' } : { title: 'Profile updated', variant: 'success' });
  };

  return (
    <div className="px-5 py-6 max-w-md mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Account</h1>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <Button variant="outline" size="sm" onClick={toggle}>{theme === 'dark' ? 'Light' : 'Dark'} mode</Button>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div><Label>Full name</Label><Input {...register('name')} /></div>
        <div><Label>Home area</Label><Input {...register('homeArea')} /></div>
        <div><Label>Work area</Label><Input {...register('workArea')} /></div>
        <Button type="submit" disabled={!isDirty} loading={isSubmitting}>Save changes</Button>
      </form>

      <div className="border-t border-border pt-4 space-y-2">
        <a href="/account/export" className="block text-sm text-accent">Export my data</a>
        <a href="/account/delete" className="block text-sm text-destructive">Delete my account</a>
      </div>
    </div>
  );
}
