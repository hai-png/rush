//
// Exports basic counters and gauges in Prometheus text format.
// Suitable for scraping by a Prometheus instance or Grafana Agent.
//
// Metrics:
//   addis_ride_requests_total{method,status} — counter
//   addis_ride_outbox_pending — gauge
//   addis_ride_outbox_dead — gauge
//   addis_ride_refund_retries_pending — gauge
//   addis_ride_active_sessions — gauge
//   addis_ride_users{role} — gauge
//   addis_ride_uptime_seconds — gauge
//
// CRITICAL FIX (C-12): This handler is now a RAW handler (registered with
// `raw: true` in api-routes.ts). It returns a NextResponse with text/plain
// content-type so Prometheus can parse it. The previous non-raw version
// returned `{ status, data, headers }` which the api() wrapper serialized
// as JSON, breaking Prometheus scraping.
//
// CRITICAL FIX (C-12): recordRequest is now called from the api() wrapper's
// completion path (see api.ts) so the request counter is actually incremented.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const startTime = Date.now();

// Simple in-memory counters (reset on process restart — Prometheus handles
// rate() correctly across counter resets).
const requestCounters = new Map<string, number>();

export function recordRequest(method: string, status: number): void {
  const key = `${method}:${status}`;
  requestCounters.set(key, (requestCounters.get(key) ?? 0) + 1);
}

// Raw handler — registered with `raw: true` in api-routes.ts.
// Returns NextResponse with text/plain content-type so Prometheus can parse it.
export async function GET_metrics(req: NextRequest, session: any, params: any, ctx: { requestId: string }): Promise<NextResponse> {
  const requestId = ctx.requestId ?? crypto.randomUUID();
  const lines: string[] = [];

  // Uptime
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  lines.push('# TYPE addis_ride_uptime_seconds gauge');
  lines.push(`addis_ride_uptime_seconds ${uptime}`);

  // Request counters
  lines.push('# TYPE addis_ride_requests_total counter');
  for (const [key, count] of requestCounters) {
    const [method, status] = key.split(':');
    lines.push(`addis_ride_requests_total{method="${method}",status="${status}"} ${count}`);
  }

  // Outbox gauges
  try {
    const pending = await db.outboxEvent.count({ where: { status: 'pending' } });
    const dead = await db.outboxEvent.count({ where: { status: 'dead' } });
    lines.push('# TYPE addis_ride_outbox_pending gauge');
    lines.push(`addis_ride_outbox_pending ${pending}`);
    lines.push('# TYPE addis_ride_outbox_dead gauge');
    lines.push(`addis_ride_outbox_dead ${dead}`);
  } catch { /* DB error — skip */ }

  // Refund retry backlog
  try {
    const refundPending = await db.refundRetry.count({ where: { status: 'pending' } });
    lines.push('# TYPE addis_ride_refund_retries_pending gauge');
    lines.push(`addis_ride_refund_retries_pending ${refundPending}`);
  } catch { /* skip */ }

  // Session count
  try {
    const activeSessions = await db.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } });
    lines.push('# TYPE addis_ride_active_sessions gauge');
    lines.push(`addis_ride_active_sessions ${activeSessions}`);
  } catch { /* skip */ }

  // User count by role
  try {
    const users = await db.user.groupBy({ by: ['role'], where: { isActive: true, deletedAt: null }, _count: true });
    lines.push('# TYPE addis_ride_users gauge');
    for (const u of users) {
      lines.push(`addis_ride_users{role="${u.role}"} ${u._count}`);
    }
  } catch { /* skip */ }

  const body = lines.join('\n') + '\n';

  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8; version=0.0.4',
      'x-request-id': requestId,
    },
  });
}
