// ToS — current version + accept.
import { CURRENT_TOS_VERSION } from '@/lib/env';
import { db } from '@/lib/db';
import { audit } from '@/lib/audit';

export async function GET_current() {
  return { data: { version: CURRENT_TOS_VERSION } };
}

export async function POST_accept({ session, ipAddress, userAgent }: any) {
  await db.user.update({
    where: { id: session.id },
    data: { tosVersion: CURRENT_TOS_VERSION },
  });
  await db.tosAcceptance.create({
    data: { userId: session.id, version: CURRENT_TOS_VERSION, ipAddress, userAgent },
  });
  await audit({
    actorId: session.id,
    action: 'tos.accepted',
    entityType: 'user',
    entityId: session.id,
    after: { version: CURRENT_TOS_VERSION },
    ipAddress, userAgent,
  });
  return { data: { ok: true, version: CURRENT_TOS_VERSION } };
}
