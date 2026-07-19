'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { Stepper, Button, Input, Label, FieldError, PhoneInput, FileDropzone } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';

const Schema = z.object({
  name: z.string().min(2, 'Enter your full name'),
  phone: z.string().regex(/^\+251(9|7)\d{8}$/, 'Enter a valid Ethiopian phone number'),
  password: z.string().min(10, 'At least 10 characters'),
  licenseNumber: z.string().min(3, 'Required'),
  experienceYears: z.coerce.number().int().min(0),
  otp: z.string().length(6, 'Enter the 6-digit code we sent you'),
  tosAccepted: z.literal(true, { errorMap: () => ({ message: 'You must accept the Terms of Service' }) }),
});
type FormValues = z.infer<typeof Schema>;
const STEPS = ['Account', 'License', 'Verify', 'Documents', 'Review'];

export default function ContractorSignupPage() {
  const [step, setStep] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<Record<string, File>>({});
  const router = useRouter();
  const client = useApiClient();
  const { register, handleSubmit, trigger, setValue, watch, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(Schema), defaultValues: { phone: '+251', experienceYears: 0 } });

  const stepFields: (keyof FormValues)[][] = [['name', 'phone', 'password'], ['licenseNumber', 'experienceYears'], ['otp'], [], ['tosAccepted']];
  const next = async () => { if (await trigger(stepFields[step])) setStep((s) => Math.min(s + 1, STEPS.length - 1)); };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const sendOtp = async () => {
    await client.POST('/api/v1/auth/otp/send', { body: { phone: watch('phone'), purpose: 'signup_verification' } });
  };

  const onSubmit = async (data: FormValues) => {
    // Documents cannot be uploaded during signup because the register endpoint does not
    // return an access token (the user must complete document upload AFTER logging in).
    // Previously this tried to use `res.accessToken` which was always undefined, so the
    // Authorization header was `Bearer undefined` and the upload silently 401'd inside a
    // `.catch(() => {})`. Pending files are now ignored here — the user is prompted to
    // upload from the contractor dashboard after their first login.
    const { error } = await client.POST('/api/v1/auth/register', {
      body: { kind: 'contractor', name: data.name, phone: data.phone, password: data.password, licenseNumber: data.licenseNumber, experienceYears: data.experienceYears, otp: data.otp },
    });
    if (error) return;
    router.push('/login?registered=1&role=contractor');
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
            <div><Label>Driving license number</Label><Input {...register('licenseNumber')} aria-invalid={!!errors.licenseNumber} /><FieldError>{errors.licenseNumber?.message}</FieldError></div>
            <div><Label>Years of experience</Label><Input type="number" min={0} {...register('experienceYears')} /><FieldError>{errors.experienceYears?.message}</FieldError></div>
          </>
        )}
        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">We sent a 6-digit code to {watch('phone')}. Enter it below to verify your number.</p>
            <Button type="button" variant="outline" onClick={sendOtp}>Send code</Button>
            <div><Label>Verification code</Label><Input inputMode="numeric" maxLength={6} {...register('otp')} aria-invalid={!!errors.otp} /><FieldError>{errors.otp?.message}</FieldError></div>
          </div>
        )}
        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">You can also upload these later from your dashboard.</p>
            <FileDropzone label="Vehicle registration" onFile={(f) => setPendingFiles((p) => ({ ...p, registration: f }))} />
            <FileDropzone label="Insurance certificate" onFile={(f) => setPendingFiles((p) => ({ ...p, insurance: f }))} />
            <FileDropzone label="Inspection certificate" onFile={(f) => setPendingFiles((p) => ({ ...p, inspection: f }))} />
          </div>
        )}
        {step === 4 && (
          <>
            <div className="rounded-xl bg-secondary p-4 text-sm space-y-1">
              <p><strong>{watch('name')}</strong> · {watch('phone')}</p>
              <p>License: {watch('licenseNumber')} · {watch('experienceYears')} yrs experience</p>
              <p>{Object.keys(pendingFiles).length} document(s) ready to upload</p>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" {...register('tosAccepted')} />
              I agree to the <a href="/legal/terms" className="text-accent underline">Terms of Service</a>
            </label>
            <FieldError>{errors.tosAccepted?.message as string}</FieldError>
          </>
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
