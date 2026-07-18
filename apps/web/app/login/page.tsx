'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Input, Label, FieldError, PhoneInput } from '@addis/ui';

const LoginSchema = z.object({
  phone: z.string().regex(/^\+251(9|7)\d{8}$/, 'Enter a valid Ethiopian phone number'),
  password: z.string().min(1, 'Password is required'),
});
type LoginForm = z.infer<typeof LoginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } =
    useForm<LoginForm>({ resolver: zodResolver(LoginSchema), defaultValues: { phone: '+251' } });

  const onSubmit = async (data: LoginForm) => {
    setServerError(null);
    const res = await signIn('credentials', { ...data, redirect: false });
    if (res?.error) { setServerError('Invalid phone number or password'); return; }
    router.push('/dashboard/rider');
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <form onSubmit={handleSubmit(onSubmit)} className="w-full max-w-sm space-y-4" noValidate>
        <h1 className="text-2xl font-semibold text-center mb-2">Welcome back</h1>

        <PhoneInput value={watch('phone')} onChange={(v) => setValue('phone', v)} error={errors.phone?.message} />

        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" aria-invalid={!!errors.password} {...register('password')} />
          <FieldError>{errors.password?.message}</FieldError>
        </div>

        {serverError && <p role="alert" className="text-sm text-destructive text-center">{serverError}</p>}

        <Button type="submit" className="w-full" loading={isSubmitting}>Log in</Button>

        <div className="flex justify-between text-sm">
          <a href="/forgot-password" className="text-accent">Forgot password?</a>
          <a href="/signup/rider" className="text-accent">Create account</a>
        </div>
      </form>
    </div>
  );
}
