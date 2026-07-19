import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LayoutDashboard, Users, Route, Bus, ShieldCheck, CreditCard, Ticket, HelpCircle, FileClock } from 'lucide-react';
import { auth } from '../../auth';

const NAV = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/routes', label: 'Routes', icon: Route },
  { href: '/admin/shuttles', label: 'Shuttles', icon: Bus },
  { href: '/admin/contractors', label: 'Contractors', icon: ShieldCheck },
  { href: '/admin/payments', label: 'Payments', icon: CreditCard },
  { href: '/admin/tickets', label: 'Tickets', icon: Ticket },
  { href: '/admin/faq', label: 'FAQ', icon: HelpCircle },
  { href: '/admin/audit-logs', label: 'Audit log', icon: FileClock },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // CRITICAL FIX: the previous layout rendered unconditionally — no auth
  // check, no role check, no redirect. Any authenticated user could
  // navigate to /admin and see the entire admin nav structure (and the
  // page components would attempt API calls that 403'd, but the layout
  // shell rendered regardless). Now we check the session and role here;
  // non-admins are redirected to their own dashboard.
  const session = await auth();
  if (!session) {
    redirect('/login?next=/admin');
  }
  const role = (session as any).role;
  if (role !== 'platform_admin') {
    redirect('/dashboard/' + (role ?? 'rider'));
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r border-border p-4 hidden md:block">
        <p className="font-semibold mb-6 px-2">Addis Ride Admin</p>
        <nav className="space-y-1">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm hover:bg-secondary">
              <Icon className="h-4 w-4" /> {label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
