import { redirect } from 'next/navigation';
import { auth } from '@/auth';

/**
 * Corporate dashboard layout. Guards /dashboard/corporate/* — only
 * authenticated users with role='corporate_admin' can access.
 */
export default async function CorporateDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/login?next=/dashboard/corporate');
  const role = (session as any)?.role;
  if (role !== 'corporate_admin') {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <h1 className="text-xl font-semibold mb-2">Access denied</h1>
          <p className="text-sm text-muted-foreground">
            The corporate dashboard is only available to corporate administrator accounts.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
