import Link from 'next/link';
import { LayoutDashboard, Users, Route, Bus, ShieldCheck, CreditCard, Ticket, HelpCircle, FileClock } from 'lucide-react';

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

export default function AdminLayout({ children }: { children: React.ReactNode }) {
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
