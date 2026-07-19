import { redirect } from 'next/navigation';
import { auth } from '@/auth';

/**
 * FIX (WEB-011): The /account/* routes had no server-side auth guard. An
 * unauthenticated visitor navigating directly to /account, /account/export,
 * or /account/delete saw the full form structure (name, home area, work area
 * inputs, "Export my data" and "Delete my account" links) — then the API
 * call 401'd and the form was broken. This layout enforces server-side auth
 * so unauthenticated visitors are redirected to /login with a `next` param
 * before any of the page content renders.
 *
 * Same pattern should be applied to /checkout, /plans, /open-seats, /tickets,
 * /tickets/new, /tickets/[id], /notifications, /tos/accept — none are
 * layout-protected today.
 */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) {
    redirect('/login?next=/account');
  }
  return <>{children}</>;
}
