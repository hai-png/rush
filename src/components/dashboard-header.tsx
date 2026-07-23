import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { SignOutButton } from '@/components/sign-out-button';
import { ThemeToggle } from '@/components/theme-toggle';

// Shared header for dashboard / admin / contractor pages so the layout is
// consistent and nav items aren't re-implemented per page. Caller passes the
// active title and an array of nav links (filtered per-role by the caller).
type NavLink = { href: string; label: string };

export function DashboardHeader({
  title,
  links = [],
  backHref,
  backLabel = 'Dashboard',
}: {
  title: string;
  links?: NavLink[];
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <header className="border-b">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          {backHref && (
            <Button asChild variant="ghost" size="sm" className="text-sm">
              <Link href={backHref}>{backLabel}</Link>
            </Button>
          )}
          <span className="text-xl font-bold truncate">{title}</span>
        </div>
        <nav className="flex gap-2 items-center">
          {links.map(l => (
            <Button key={l.href} asChild variant="ghost" size="sm">
              <Link href={l.href}>{l.label}</Link>
            </Button>
          ))}
          <ThemeToggle />
          <SignOutButton />
        </nav>
      </div>
    </header>
  );
}
