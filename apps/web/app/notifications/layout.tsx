import { redirect } from 'next/navigation';
import { auth } from '@/auth';

/** FIX (META-018): Server-side auth guard for /notifications route. */
export default async function NotificationsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/login?next=/notifications');
  return <>{children}</>;
}
