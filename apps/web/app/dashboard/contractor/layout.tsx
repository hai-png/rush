import { redirect } from 'next/navigation';
import { auth } from '@/auth';

export default async function ContractorDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/login?next=/dashboard/contractor');
  const role = (session as any)?.role;
  if (role !== 'contractor') {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <h1 className="text-xl font-semibold mb-2">Access denied</h1>
          <p className="text-sm text-muted-foreground">
            The contractor dashboard is only available to verified contractor accounts.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
