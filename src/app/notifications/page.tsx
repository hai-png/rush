import Link from 'next/link';
import type { Metadata } from 'next';
import { requireSession } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { NotificationActions } from './notification-actions';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Notifications · Addis Ride' };

export default async function NotificationsPage() {
  const session = await requireSession();
  const notifs = await db.notification.findMany({
    where: { userId: session.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const unreadCount = notifs.filter(n => !n.readAt).length;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Addis Ride</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/dashboard/rider">Dashboard</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Notifications</h1>
            {unreadCount > 0 && (
              <p className="text-sm text-muted-foreground">{unreadCount} unread</p>
            )}
          </div>
          {unreadCount > 0 && <NotificationActions mode="mark-all" />}
        </div>
        {notifs.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-muted-foreground">No notifications.</CardContent></Card>
        ) : (
          <Card>
            <CardContent className="py-3 divide-y">
              {notifs.map(n => (
                <div key={n.id} className={`py-3 ${!n.readAt ? 'bg-primary/5 -mx-3 px-3 rounded' : ''}`}>
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {!n.readAt && <Badge>New</Badge>}
                        <div className="font-medium text-sm">{n.title}</div>
                      </div>
                      <div className="text-sm text-muted-foreground">{n.body}</div>
                      <div className="text-xs text-muted-foreground mt-1">{formatDateTime(n.createdAt)}</div>
                      {n.link && (
                        <Link href={n.link} className="text-xs text-primary hover:underline mt-1 inline-block">View →</Link>
                      )}
                    </div>
                    {!n.readAt && <NotificationActions mode="mark-one" id={n.id} />}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
