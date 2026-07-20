import { redirect } from 'next/navigation';
import { auth } from '@/auth';

export default async function RiderDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/login?next=/dashboard/rider');
  const role = (session as any)?.role;
  if (role === 'contractor') redirect('/dashboard/contractor');
  if (role === 'corporate_admin') redirect('/dashboard/corporate');
  if (role === 'platform_admin') redirect('/admin');
  if (role !== 'rider') {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <h1 className="text-xl font-semibold mb-2">Access denied</h1>
          <p className="text-sm text-muted-foreground">Your account does not have access to the rider dashboard.</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
