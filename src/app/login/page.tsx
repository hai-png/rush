import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign In · Addis Ride' };

// FE-033: page-level metadata. The actual form is a client component
// (login-form.tsx) because it uses useState/useSearchParams; metadata can
// only be exported from a server component, so this thin wrapper renders
// the form.
export default function LoginPage() {
  return <LoginForm />;
}
