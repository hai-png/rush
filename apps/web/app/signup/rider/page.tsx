'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { Stepper, Button, Input, Label, FieldError, PhoneInput, useToast } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';

const Schema = z.object({
  name: z.string().min(2, 'Enter your full name'),
  phone: z.string().regex(/^\+251(9|7)\d{8}$/, 'Enter a valid Ethiopian phone number'),
  password: z.string().min(10, 'At least 10 characters'),
  homeArea: z.string().min(2, 'Required'),
  workArea: z.string().min(2, 'Required'),
  tosAccepted: z.literal(true, { errorMap: () => ({ message: 'You must accept the Terms of Service' }) }),
});
type FormValues = z.infer<typeof Schema>;
const STEPS = ['Account', 'Commute', 'Review'];

function describeSignupError(err: any): string {
  const code = err?.error?.code ?? err?.code;
  const message: string | undefined = err?.error?.message ?? err?.message;
  const status: number | undefined = err?.response?.status;
  if (status === 409 || code === 'CONFLICT') {
    return 'This phone number is already registered. Try logging in instead.';
  }
  if (status === 400 || code === 'BAD_REQUEST') {
    if (message && /breach/i.test(message)) {
      return 'This password has appeared in a known data breach. Please choose a different one.';
    }
    return message ?? 'Some details are invalid. Please review and try again.';
  }
  if (status && status >= 500) {
    return 'Something went wrong on our end. Please try again in a moment.';
  }
  return message ?? 'Could not create your account. Please try again.';
}

export default function RiderSignupPage() {
  const [step, setStep] = useState(0);
  const router = useRouter();
  const client = useApiClient();
  const { push: pushToast } = useToast();

  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, trigger, setValue, watch, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(Schema), defaultValues: { phone: '+251' } });

  const stepFields: (keyof FormValues)[][] = [['name', 'phone', 'password'], ['homeArea', 'workArea'], ['tosAccepted']];

  const next = async () => { if (await trigger(stepFields[step])) { setServerError(null); setStep((s) => Math.min(s + 1, STEPS.length - 1)); } };
  const back = () => { setServerError(null); setStep((s) => Math.max(s - 1, 0)); };

  const onSubmit = async (data: FormValues) => {
    setServerError(null);
    const { error } = await client.POST('/api/v1/auth/register', {
      body: { kind: 'rider', name: data.name, phone: data.phone, password: data.password, homeArea: data.homeArea, workArea: data.workArea },
    });
    if (error) {

      const msg = describeSignupError(error);
      setServerError(msg);
      pushToast({ title: msg, variant: 'error' });
      return;
    }
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

        {}
        {serverError && (
          <p role="alert" aria-live="assertive" className="text-sm text-destructive">
            {serverError}
          </p>
        )}

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
