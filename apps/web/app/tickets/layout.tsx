import { redirect } from 'next/navigation';
import { auth } from '@/auth';

/** FIX (META-018): Server-side auth guard for /tickets/* routes. */
export default async function TicketsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/login?next=/tickets');
  return <>{children}</>;
}
