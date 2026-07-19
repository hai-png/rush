'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button, Input, Label, FieldError, PhoneInput } from '@addis/ui';

const LoginSchema = z.object({
  phone: z.string().regex(/^\+251(9|7)\d{8}$/, 'Enter a valid Ethiopian phone number'),
  password: z.string().min(1, 'Password is required'),
});
type LoginForm = z.infer<typeof LoginSchema>;

const TwoFactorSchema = z.object({
  code: z.string().length(6, 'Enter the 6-digit code from your authenticator app'),
});
type TwoFactorForm = z.infer<typeof TwoFactorSchema>;

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(null);
  const [needs2fa, setNeeds2fa] = useState(false);
  // Stash the credentials between the first (password) and second (2FA) signIn() call.
  // We don't put the password in the URL or query string — keep it in component state only.
  const [pendingCreds, setPendingCreds] = useState<{ phone: string; password: string } | null>(null);

  const { register: registerLogin, handleSubmit: handleSubmitLogin, setValue: setLoginValue, watch: watchLogin, formState: { errors: errorsLogin, isSubmitting: isSubmittingLogin } } =
    useForm<LoginForm>({ resolver: zodResolver(LoginSchema), defaultValues: { phone: '+251' } });

  const { register: register2fa, handleSubmit: handleSubmit2fa, formState: { errors: errors2fa, isSubmitting: isSubmitting2fa } } =
    useForm<TwoFactorForm>({ resolver: zodResolver(TwoFactorSchema) });

  const onLoginSubmit = async (data: LoginForm) => {
    setServerError(null);
    // Ask NextAuth to call authorize(). If the user has 2FA enabled, identityService.login
    // throws TwoFactorRequiredError, which we re-throw as `new Error('TwoFactorRequired')` —
    // NextAuth surfaces that as `res.error === 'TwoFactorRequired'`.
    const res = await signIn('credentials', { ...data, redirect: false });
    if (res?.error === 'TwoFactorRequired') {
      setPendingCreds(data);
      setNeeds2fa(true);
      return;
    }
    if (res?.error) { setServerError('Invalid phone number or password'); return; }
    const next = params.get('next');
    router.push(next ?? '/dashboard/rider');
  };

  const on2faSubmit = async (data: TwoFactorForm) => {
    setServerError(null);
    if (!pendingCreds) { setNeeds2fa(false); return; }
    const res = await signIn('credentials', { ...pendingCreds, code: data.code, redirect: false });
    setPendingCreds(null); // clear password from memory as soon as it's been used
    if (res?.error) { setServerError('Invalid 2FA code'); setNeeds2fa(false); return; }
    const next = params.get('next');
    router.push(next ?? '/dashboard/rider');
  };

  if (needs2fa) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <form onSubmit={handleSubmit2fa(on2faSubmit)} className="w-full max-w-sm space-y-4" noValidate>
          <h1 className="text-2xl font-semibold text-center mb-2">Two-factor code</h1>
          <p className="text-sm text-muted-foreground text-center">Enter the 6-digit code from your authenticator app.</p>
          <div>
            <Label htmlFor="code">Authentication code</Label>
            <Input id="code" inputMode="numeric" maxLength={6} aria-invalid={!!errors2fa.code} {...register2fa('code')} />
            <FieldError>{errors2fa.code?.message}</FieldError>
          </div>
          {serverError && <p role="alert" className="text-sm text-destructive text-center">{serverError}</p>}
          <Button type="submit" className="w-full" loading={isSubmitting2fa}>Verify and log in</Button>
          <button type="button" onClick={() => { setNeeds2fa(false); setPendingCreds(null); setServerError(null); }} className="w-full text-sm text-muted-foreground">
            Use a different account
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <form onSubmit={handleSubmitLogin(onLoginSubmit)} className="w-full max-w-sm space-y-4" noValidate>
        <h1 className="text-2xl font-semibold text-center mb-2">Welcome back</h1>

        <PhoneInput value={watchLogin('phone')} onChange={(v) => setLoginValue('phone', v)} error={errorsLogin.phone?.message} />

        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" aria-invalid={!!errorsLogin.password} {...registerLogin('password')} />
          <FieldError>{errorsLogin.password?.message}</FieldError>
        </div>

        {serverError && <p role="alert" className="text-sm text-destructive text-center">{serverError}</p>}

        <Button type="submit" className="w-full" loading={isSubmittingLogin}>Log in</Button>

        <div className="flex justify-between text-sm">
          <a href="/forgot-password" className="text-accent">Forgot password?</a>
          <a href="/signup/rider" className="text-accent">Create account</a>
        </div>
      </form>
    </div>
  );
}
