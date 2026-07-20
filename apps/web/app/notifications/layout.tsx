import { redirect } from 'next/navigation';
import { auth } from '@/auth';

export default async function NotificationsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/login?next=/notifications');
  return <>{children}</>;
}
