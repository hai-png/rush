'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { Button, Input, Label, FieldError, PhoneInput } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';

const Schema = z.object({
  corpName: z.string().min(2),
  corpCode: z.string().min(2).max(12).regex(/^[A-Z0-9-]+$/, 'Uppercase letters, numbers, hyphens only'),
  contactEmail: z.string().email(),
  contactPhone: z.string().regex(/^\+251(9|7)\d{8}$/),
  adminName: z.string().min(2),
  adminPassword: z.string().min(10),
  subsidyPercent: z.coerce.number().min(0).max(100),
  monthlySeatAllowance: z.coerce.number().int().positive(),
});
type FormValues = z.infer<typeof Schema>;

export default function CorporateSignupPage() {
  const router = useRouter();
  const client = useApiClient();
  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(Schema), defaultValues: { contactPhone: '+251', subsidyPercent: 50, monthlySeatAllowance: 20 } });

  const onSubmit = async (data: FormValues) => {
    const { error } = await client.POST('/api/v1/corporate/signup', { body: data });
    if (!error) router.push('/login?registered=1&role=corporate_admin');
  };

  return (
    <div className="min-h-screen px-6 py-10 max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-6">Register your company</h1>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <div><Label>Company name</Label><Input {...register('corpName')} aria-invalid={!!errors.corpName} /><FieldError>{errors.corpName?.message}</FieldError></div>
        <div><Label>Company code (public, e.g. ETH-TEL)</Label><Input {...register('corpCode')} aria-invalid={!!errors.corpCode} /><FieldError>{errors.corpCode?.message}</FieldError></div>
        <div><Label>Contact email</Label><Input type="email" {...register('contactEmail')} aria-invalid={!!errors.contactEmail} /><FieldError>{errors.contactEmail?.message}</FieldError></div>
        <PhoneInput label="Contact phone" value={watch('contactPhone')} onChange={(v) => setValue('contactPhone', v)} error={errors.contactPhone?.message} />
        <div><Label>Admin full name</Label><Input {...register('adminName')} aria-invalid={!!errors.adminName} /><FieldError>{errors.adminName?.message}</FieldError></div>
        <div><Label>Admin password</Label><Input type="password" {...register('adminPassword')} aria-invalid={!!errors.adminPassword} /><FieldError>{errors.adminPassword?.message}</FieldError></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Subsidy %</Label><Input type="number" min={0} max={100} {...register('subsidyPercent')} /></div>
          <div><Label>Monthly seat allowance</Label><Input type="number" min={1} {...register('monthlySeatAllowance')} /></div>
        </div>
        <Button type="submit" className="w-full" loading={isSubmitting}>Register company</Button>
      </form>
    </div>
  );
}
