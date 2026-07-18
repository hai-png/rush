'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { Button, Input, Label, FieldError, PhoneInput } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';

const PhoneSchema = z.object({ phone: z.string().regex(/^\+251(9|7)\d{8}$/) });
const ResetSchema = z.object({ code: z.string().length(6), newPassword: z.string().min(10) });

export default function ForgotPasswordPage() {
  const [stage, setStage] = useState<'phone' | 'reset'>('phone');
  const [phone, setPhone] = useState('+251');
  const client = useApiClient();
  const router = useRouter();

  const phoneForm = useForm({ resolver: zodResolver(PhoneSchema), defaultValues: { phone: '+251' } });
  const resetForm = useForm({ resolver: zodResolver(ResetSchema) });

  const sendOtp = async (data: z.infer<typeof PhoneSchema>) => {
    await client.POST('/api/v1/auth/password/reset', { body: { phone: data.phone } });
    setPhone(data.phone); setStage('reset');
  };
  const confirmReset = async (data: z.infer<typeof ResetSchema>) => {
    const { error } = await client.POST('/api/v1/auth/password/reset/confirm', { body: { phone, ...data } });
    if (!error) router.push('/login?reset=1');
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      {stage === 'phone' ? (
        <form onSubmit={phoneForm.handleSubmit(sendOtp)} className="w-full max-w-sm space-y-4" noValidate>
          <h1 className="text-xl font-semibold text-center">Reset your password</h1>
          <PhoneInput value={phoneForm.watch('phone')} onChange={(v) => phoneForm.setValue('phone', v)} error={phoneForm.formState.errors.phone?.message} />
          <Button type="submit" className="w-full" loading={phoneForm.formState.isSubmitting}>Send code</Button>
        </form>
      ) : (
        <form onSubmit={resetForm.handleSubmit(confirmReset)} className="w-full max-w-sm space-y-4" noValidate>
          <h1 className="text-xl font-semibold text-center">Enter the code sent to {phone}</h1>
          <div><Label>6-digit code</Label><Input maxLength={6} {...resetForm.register('code')} /><FieldError>{resetForm.formState.errors.code?.message}</FieldError></div>
          <div><Label>New password</Label><Input type="password" {...resetForm.register('newPassword')} /><FieldError>{resetForm.formState.errors.newPassword?.message}</FieldError></div>
          <Button type="submit" className="w-full" loading={resetForm.formState.isSubmitting}>Reset password</Button>
        </form>
      )}
    </div>
  );
}
