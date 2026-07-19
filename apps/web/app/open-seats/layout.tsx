import { redirect } from 'next/navigation';
import { auth } from '@/auth';

/** FIX (META-018): Server-side auth guard for /open-seats route. */
export default async function OpenSeatsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/login?next=/open-seats');
  return <>{children}</>;
}
