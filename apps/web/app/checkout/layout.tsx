import { redirect } from 'next/navigation';
import { auth } from '@/auth';

/**
 * FIX (META-018): Server-side auth guard for /checkout/* routes.
 * Unauthenticated visitors see broken forms before the API 401s.
 */
export default async function CheckoutLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/login?next=/checkout');
  return <>{children}</>;
}
