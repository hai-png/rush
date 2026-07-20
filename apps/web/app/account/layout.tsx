import { redirect } from 'next/navigation';
import { auth } from '@/auth';

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) {
    redirect('/login?next=/account');
  }
  return <>{children}</>;
}
