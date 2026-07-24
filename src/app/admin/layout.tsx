'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { SignOutButton } from '@/components/sign-out-button';
import { Bus, Users, CreditCard, Ticket, FileText, Truck, Route, CalendarDays, Building2, HelpCircle, Settings, ScrollText, ClipboardList } from 'lucide-react';

const navItems = [
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/payments', label: 'Payments', icon: CreditCard },
  { href: '/admin/plans', label: 'Plans', icon: Ticket },
  { href: '/admin/contractors', label: 'Contractors', icon: ClipboardList },
  { href: '/admin/shuttles', label: 'Shuttles', icon: Truck },
  { href: '/admin/routes', label: 'Routes', icon: Route },
  { href: '/admin/assignments', label: 'Assignments', icon: CalendarDays },
  { href: '/admin/subscriptions', label: 'Subscriptions', icon: FileText },
  { href: '/admin/corporates', label: 'Corporates', icon: Building2 },
  { href: '/admin/faqs', label: 'FAQs', icon: HelpCircle },
  { href: '/admin/tickets', label: 'Tickets', icon: Ticket },
  { href: '/admin/audit-logs', label: 'Audit Logs', icon: ScrollText },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col md:flex-row">
      <aside className="md:w-64 md:min-h-screen border-r bg-background flex-shrink-0">
        <div className="p-4 border-b flex items-center gap-2">
          <Bus className="h-5 w-5 text-primary" />
          <span className="font-bold">Addis Ride</span>
          <span className="text-xs text-muted-foreground ml-auto">Admin</span>
        </div>
        <nav className="p-2 flex md:flex-col gap-1 overflow-x-auto md:overflow-x-visible">
          {navItems.map(item => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm whitespace-nowrap md:w-full ${
                  active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="hidden md:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="p-2 border-t mt-auto hidden md:block">
          <Link href="/dashboard/admin">
            <Button variant="ghost" size="sm" className="w-full justify-start">← Dashboard</Button>
          </Link>
          <div className="mt-2">
            <SignOutButton />
          </div>
        </div>
      </aside>

      <main className="flex-1 p-4 md:p-8 overflow-x-auto">
        {children}
      </main>
    </div>
  );
}
