'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button, Input, Label, FieldError } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';

const Schema = z.object({ corporateCode: z.string().min(2), employeeId: z.string().min(1) });

export default function CorporateOnboardPage() {
  const params = useSearchParams();
  const router = useRouter();
  const client = useApiClient();
  const { register, handleSubmit, formState: { errors, isSubmitting } } =
    useForm<z.infer<typeof Schema>>({ resolver: zodResolver(Schema), defaultValues: { corporateCode: params.get('corp') ?? '', employeeId: '' } });

  const onSubmit = async (data: z.infer<typeof Schema>) => {
    const { error } = await client.POST('/api/v1/corporate/onboard', { body: data });
    if (!error) router.push('/corporate/me?pending=1');
  };

  return (
    <div className="min-h-screen px-6 py-10 max-w-sm mx-auto">
      <h1 className="text-xl font-semibold mb-2">Link your employer</h1>
      <p className="text-sm text-muted-foreground mb-6">Your subsidy will apply once your employer approves this request.</p>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <div><Label>Company code</Label><Input {...register('corporateCode')} aria-invalid={!!errors.corporateCode} /><FieldError>{errors.corporateCode?.message}</FieldError></div>
        <div><Label>Employee ID</Label><Input {...register('employeeId')} aria-invalid={!!errors.employeeId} /><FieldError>{errors.employeeId?.message}</FieldError></div>
        <Button type="submit" className="w-full" loading={isSubmitting}>Request link</Button>
      </form>
    </div>
  );
}
