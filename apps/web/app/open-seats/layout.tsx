import { redirect } from 'next/navigation';
import { auth } from '@/auth';

export default async function OpenSeatsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/login?next=/open-seats');
  return <>{children}</>;
}
