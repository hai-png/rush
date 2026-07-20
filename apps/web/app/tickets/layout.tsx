import { redirect } from 'next/navigation';
import { auth } from '@/auth';

export default async function TicketsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/login?next=/tickets');
  return <>{children}</>;
}
