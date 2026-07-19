'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { Button, Input, Label, FieldError, PhoneInput, useToast } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';

// Validate OTP as 6 digits (not just any 6-char string) — the previous
// schema accepted 'abcdef' as a valid code, deferring only to the API.
const PhoneSchema = z.object({ phone: z.string().regex(/^\+251(9|7)\d{8}$/) });
const ResetSchema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/, 'Code must be 6 digits'),
  newPassword: z.string().min(10).max(1000),
});

export default function ForgotPasswordPage() {
  const [stage, setStage] = useState<'phone' | 'reset'>('phone');
  const [phone, setPhone] = useState('+251');
  const [serverError, setServerError] = useState<string | null>(null);
  const client = useApiClient();
  const router = useRouter();
  const { push } = useToast();

  const phoneForm = useForm({ resolver: zodResolver(PhoneSchema), defaultValues: { phone: '+251' } });
  const resetForm = useForm({ resolver: zodResolver(ResetSchema) });

  const sendOtp = async (data: z.infer<typeof PhoneSchema>) => {
    setServerError(null);
    const { error } = await client.POST('/api/v1/auth/password/reset', { body: { phone: data.phone } });
    if (error) {
      // Don't transition to reset stage if the API errored — the previous
      // implementation always transitioned, telling the user "code sent to
      // {phone}" even if the phone didn't exist, enabling user enumeration.
      setServerError(error.message ?? 'Could not send code');
      return;
    }
    setPhone(data.phone);
    setStage('reset');
  };
  const confirmReset = async (data: z.infer<typeof ResetSchema>) => {
    setServerError(null);
    const { error } = await client.POST('/api/v1/auth/password/reset/confirm', { body: { phone, ...data } });
    if (error) {
      setServerError(error.message ?? 'Could not reset password');
      return;
    }
    push({ title: 'Password reset — please log in', variant: 'success' });
    router.push('/login?reset=1');
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      {stage === 'phone' ? (
        <form onSubmit={phoneForm.handleSubmit(sendOtp)} className="w-full max-w-sm space-y-4" noValidate>
          <h1 className="text-xl font-semibold text-center">Reset your password</h1>
          <PhoneInput value={phoneForm.watch('phone')} onChange={(v) => phoneForm.setValue('phone', v)} error={phoneForm.formState.errors.phone?.message} />
          {serverError && <p role="alert" className="text-sm text-destructive text-center">{serverError}</p>}
          <Button type="submit" className="w-full" loading={phoneForm.formState.isSubmitting}>Send code</Button>
        </form>
      ) : (
        <form onSubmit={resetForm.handleSubmit(confirmReset)} className="w-full max-w-sm space-y-4" noValidate>
          <h1 className="text-xl font-semibold text-center">Enter the code sent to {phone}</h1>
          <div>
            <Label htmlFor="code">6-digit code</Label>
            <Input id="code" maxLength={6} inputMode="numeric" pattern="\d{6}" {...resetForm.register('code')} />
            <FieldError>{resetForm.formState.errors.code?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="newPassword">New password</Label>
            <Input id="newPassword" type="password" autoComplete="new-password" {...resetForm.register('newPassword')} />
            <FieldError>{resetForm.formState.errors.newPassword?.message}</FieldError>
          </div>
          {serverError && <p role="alert" className="text-sm text-destructive text-center">{serverError}</p>}
          <Button type="submit" className="w-full" loading={resetForm.formState.isSubmitting}>Reset password</Button>
        </form>
      )}
    </div>
  );
}
