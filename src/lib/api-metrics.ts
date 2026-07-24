import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const startTime = Date.now();

const requestCounters = new Map<string, number>();

export function recordRequest(method: string, status: number): void {
  const key = `${method}:${status}`;
  requestCounters.set(key, (requestCounters.get(key) ?? 0) + 1);
}

export async function GET_metrics(req: NextRequest, session: any, params: any, ctx: { requestId: string }): Promise<NextResponse> {
  const requestId = ctx.requestId ?? crypto.randomUUID();
  const lines: string[] = [];

  const uptime = Math.floor((Date.now() - startTime) / 1000);
  lines.push('# TYPE addis_ride_uptime_seconds gauge');
  lines.push(`addis_ride_uptime_seconds ${uptime}`);

  lines.push('# TYPE addis_ride_requests_total counter');
  for (const [key, count] of requestCounters) {
    const [method, status] = key.split(':');
    lines.push(`addis_ride_requests_total{method="${method}",status="${status}"} ${count}`);
  }

  try {
    const pending = await db.outboxEvent.count({ where: { status: 'pending' } });
    const dead = await db.outboxEvent.count({ where: { status: 'dead' } });
    lines.push('# TYPE addis_ride_outbox_pending gauge');
    lines.push(`addis_ride_outbox_pending ${pending}`);
    lines.push('# TYPE addis_ride_outbox_dead gauge');
    lines.push(`addis_ride_outbox_dead ${dead}`);
  } catch {  }

  try {
    const refundPending = await db.refundRetry.count({ where: { status: 'pending' } });
    lines.push('# TYPE addis_ride_refund_retries_pending gauge');
    lines.push(`addis_ride_refund_retries_pending ${refundPending}`);
  } catch {  }

  try {
    const activeSessions = await db.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } });
    lines.push('# TYPE addis_ride_active_sessions gauge');
    lines.push(`addis_ride_active_sessions ${activeSessions}`);
  } catch {  }

  try {
    const users = await db.user.groupBy({ by: ['role'], where: { isActive: true, deletedAt: null }, _count: true });
    lines.push('# TYPE addis_ride_users gauge');
    for (const u of users) {
      lines.push(`addis_ride_users{role="${u.role}"} ${u._count}`);
    }
  } catch {  }

  const body = lines.join('\n') + '\n';

  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8; version=0.0.4',
      'x-request-id': requestId,
    },
  });
}

