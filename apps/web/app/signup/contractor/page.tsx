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
  tosAccepted: z.literal(true, { errorMap: () => ({ message: 'You must accept the Terms of Service' }) }),
});
type FormValues = z.infer<typeof Schema>;
const STEPS = ['Account', 'License', 'Documents', 'Review'];

export default function ContractorSignupPage() {
  const [step, setStep] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<Record<string, File>>({});
  const router = useRouter();
  const client = useApiClient();
  const { register, handleSubmit, trigger, setValue, watch, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(Schema), defaultValues: { phone: '+251', experienceYears: 0 } });

  const stepFields: (keyof FormValues)[][] = [['name', 'phone', 'password'], ['licenseNumber', 'experienceYears'], [], ['tosAccepted']];
  const next = async () => { if (await trigger(stepFields[step])) setStep((s) => Math.min(s + 1, STEPS.length - 1)); };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const onSubmit = async (data: FormValues) => {
    const { data: res, error } = await client.POST('/api/v1/auth/register', {
      body: { kind: 'contractor', name: data.name, phone: data.phone, password: data.password, licenseNumber: data.licenseNumber, experienceYears: data.experienceYears },
    });
    if (error) return;

    // Upload any documents already selected during signup (optional at this stage — can also be done post-login)
    // FIX (WEB-010): The previous implementation sent `Authorization: Bearer ${undefined ?? ''}`
    // when res.accessToken was missing — the header became `Authorization: Bearer ` (empty),
    // the API 401'd, and `.catch(() => {})` silently swallowed the error. The contractor
    // thought their documents were uploaded but they weren't — they only found out when
    // their verification was stuck in "pending" forever. Now: skip the upload entirely
    // if there's no token (the contractor can upload post-login via the dashboard), and
    // surface upload failures instead of swallowing them.
    const token = (res as any)?.accessToken;
    if (token && Object.keys(pendingFiles).length > 0) {
      for (const [type, file] of Object.entries(pendingFiles)) {
        const form = new FormData();
        form.append('type', type); form.append('file', file);
        const r = await fetch('/api/v1/contractors/documents', {
          method: 'POST', body: form, headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) {
          // Don't abort the whole signup — the contractor account is already
          // created. Just warn them so they know to upload via the dashboard.
          console.warn(`Failed to upload ${type} during signup (HTTP ${r.status}) — please upload via the contractor dashboard after logging in.`);
        }
      }
    }
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
            <p className="text-sm text-muted-foreground">You can also upload these later from your dashboard.</p>
            <FileDropzone label="Vehicle registration" onFile={(f) => setPendingFiles((p) => ({ ...p, registration: f }))} />
            <FileDropzone label="Insurance certificate" onFile={(f) => setPendingFiles((p) => ({ ...p, insurance: f }))} />
            <FileDropzone label="Inspection certificate" onFile={(f) => setPendingFiles((p) => ({ ...p, inspection: f }))} />
          </div>
        )}
        {step === 3 && (
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
