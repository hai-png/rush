/**
 * Audit outbox handler. Most audit rows are written synchronously via writeAudit()
 * inside the same transaction as the action they record — those rows live in the
 * `audit_logs` table, not the outbox. The `audit` outbox channel is reserved for
 * async audit fan-out (e.g. streaming to an external SIEM or compliance archive).
 *
 * For now this handler is a no-op that simply logs the event — the writeAudit()
 * path is the system of record. If/when an external SIEM integration is added,
 * this is where the forwarder call would go.
 */
export async function handle(payload: { action: string; entityId?: string; [k: string]: unknown }) {
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[audit-outbox] ${payload.action} entityId=${payload.entityId ?? '-'}`);
  }
}
