'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { Stepper, Button, Input, Label, FieldError, PhoneInput } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';

const Schema = z.object({
  name: z.string().min(2, 'Enter your full name'),
  phone: z.string().regex(/^\+251(9|7)\d{8}$/, 'Enter a valid Ethiopian phone number'),
  password: z.string().min(10, 'At least 10 characters'),
  homeArea: z.string().min(2, 'Required'),
  workArea: z.string().min(2, 'Required'),
  otp: z.string().length(6, 'Enter the 6-digit code we sent you'),
  tosAccepted: z.literal(true, { errorMap: () => ({ message: 'You must accept the Terms of Service' }) }),
});
type FormValues = z.infer<typeof Schema>;
const STEPS = ['Account', 'Commute', 'Verify', 'Review'];

export default function RiderSignupPage() {
  const [step, setStep] = useState(0);
  const [serverError, setServerError] = useState<string | null>(null);
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const router = useRouter();
  const client = useApiClient();
  const { register, handleSubmit, trigger, setValue, watch, getValues, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(Schema), defaultValues: { phone: '+251', otp: '' } });

  const stepFields: (keyof FormValues)[][] = [['name', 'phone', 'password'], ['homeArea', 'workArea'], ['otp'], ['tosAccepted']];

  const next = async () => { if (await trigger(stepFields[step])) setStep((s) => Math.min(s + 1, STEPS.length - 1)); };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const sendOtp = async () => {
    setServerError(null);
    const phone = getValues('phone');
    if (!/^\+251(9|7)\d{8}$/.test(phone)) { setServerError('Enter a valid phone number first'); return; }
    setSendingOtp(true);
    const { error } = await client.POST('/api/v1/auth/otp/send', { body: { phone, purpose: 'signup_verification' } });
    setSendingOtp(false);
    if (error) { setServerError('Could not send code. Try again.'); return; }
    setOtpSent(true);
  };

  const onSubmit = async (data: FormValues) => {
    setServerError(null);
    const { error } = await client.POST('/api/v1/auth/register', {
      body: { kind: 'rider', name: data.name, phone: data.phone, password: data.password, homeArea: data.homeArea, workArea: data.workArea, otp: data.otp },
    });
    if (error) { setServerError(error.message ?? 'Could not create account.'); return; }
    router.push('/login?registered=1');
  };

  return (
    <div className="min-h-screen px-6 py-10 max-w-md mx-auto">
      <Stepper steps={STEPS} current={step} />
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {step === 0 && (
          <>
            <div><Label>Full name</Label><Input {...register('name')} aria-invalid={!!errors.name} /><FieldError>{errors.name?.message}</FieldError></div>
            <PhoneInput value={watch('phone')} onChange={(v) => setValue('phone', v)} error={errors.phone?.message} />
            <div><Label>Password</Label><Input type="password" {...register('password')} aria-invalid={!!errors.password} /><FieldError>{errors.password?.message}</FieldError></div>
          </>
        )}
        {step === 1 && (
          <>
            <div><Label>Home area</Label><Input {...register('homeArea')} aria-invalid={!!errors.homeArea} /><FieldError>{errors.homeArea?.message}</FieldError></div>
            <div><Label>Work area</Label><Input {...register('workArea')} aria-invalid={!!errors.workArea} /><FieldError>{errors.workArea?.message}</FieldError></div>
          </>
        )}
        {step === 2 && (
          <>
            <p className="text-sm text-muted-foreground">We sent a 6-digit code to {watch('phone')}. Enter it below to verify your number.</p>
            {!otpSent && (
              <Button type="button" variant="outline" loading={sendingOtp} onClick={sendOtp}>Send code</Button>
            )}
            {otpSent && (
              <>
                <div><Label>Verification code</Label><Input inputMode="numeric" maxLength={6} {...register('otp')} aria-invalid={!!errors.otp} /><FieldError>{errors.otp?.message}</FieldError></div>
                <button type="button" onClick={sendOtp} className="text-xs text-accent">Resend code</button>
              </>
            )}
          </>
        )}
        {step === 3 && (
          <>
            <div className="rounded-xl bg-secondary p-4 text-sm space-y-1">
              <p><strong>{watch('name')}</strong> · {watch('phone')}</p>
              <p>{watch('homeArea')} → {watch('workArea')}</p>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" {...register('tosAccepted')} />
              I agree to the <a href="/legal/terms" className="text-accent underline">Terms of Service</a> and <a href="/legal/privacy" className="text-accent underline">Privacy Policy</a>
            </label>
            <FieldError>{errors.tosAccepted?.message as string}</FieldError>
          </>
        )}

        {serverError && <p role="alert" className="text-sm text-destructive text-center">{serverError}</p>}

        <div className="flex gap-3 pt-2">
          {step > 0 && <Button type="button" variant="outline" onClick={back}>Back</Button>}
          {step < STEPS.length - 1
            ? <Button type="button" className="flex-1" onClick={next}>Continue</Button>
            : <Button type="submit" className="flex-1" loading={isSubmitting}>Create account</Button>}
        </div>
      </form>
    </div>
  );
}
