import { getSession } from '@/lib/session-server';
import { redirect } from 'next/navigation';
import { CorporateSignupForm } from './signup-form';

export default async function CorporateSignupPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/corporate/signup');
  if (session.role !== 'rider') redirect('/');
  return <CorporateSignupForm />;
}
