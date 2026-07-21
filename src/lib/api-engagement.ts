// Engagement — notifications.
import { db } from '@/lib/db';

export async function GET_notifications({ session }: any) {
  const notifs = await db.notification.findMany({
    where: { userId: session.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return { data: notifs };
}

export async function POST_mark_read({ session, params }: any) {
  await db.notification.updateMany({
    where: { id: params.id, userId: session.id },
    data: { readAt: new Date() },
  });
  return { data: { ok: true } };
}

export async function POST_mark_all_read({ session }: any) {
  await db.notification.updateMany({
    where: { userId: session.id, readAt: null },
    data: { readAt: new Date() },
  });
  return { data: { ok: true } };
}
