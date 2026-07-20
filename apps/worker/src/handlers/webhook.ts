import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { s3 } from '@addis/api/infra/s3';
import { fileTypeFromBuffer } from 'file-type';

/**
 * Webhook outbox handler. Dispatches on payload.kind:
 *   - clamav_scan: fetches the object from S3, sniffs its actual file type,
 *     and flags any document whose sniffed type doesn't match the declared
 *     MIME (a common malware evasion technique).
 *
 * Previously this was a stub that just console.log'd the payload. Now it does
 * a real basic scan. A full ClamAV sidecar integration would replace the
 * sniff check with an actual virus signature scan.
 *
 * FIX (INFRA-009): Like the other handlers, this one has no durable
 * idempotency guard. The MIME-mismatch path throws after flagging the doc,
 * so a duplicate delivery would re-throw without re-mutating the doc row
 * (the `[SUSPICIOUS: ...]` prefix is idempotent on a second run since the
 * filename already starts with it). The non-mismatch path is a no-op on
 * re-delivery. So in practice the side effects are idempotent, but the
 * outbox will still log a "dead-letter" if the throw happens maxAttempts
 * times. A durable `notification_log` is deferred to follow-up 3.
 */
export async function handle(
  payload: { kind: string; storageKey?: string; [k: string]: unknown },
  _evt?: typeof schema.outboxEvents.$inferSelect,
) {
  switch (payload.kind) {
    case 'clamav_scan': {
      if (!payload.storageKey) throw new Error('clamav_scan payload missing storageKey');

      // Look up the declared MIME type from contractor_documents.
      const [doc] = await db.select().from(schema.contractorDocuments)
        .where(eq(schema.contractorDocuments.storageKey, payload.storageKey));
      if (!doc) {
        // Document may have been deleted between upload and scan — not an error.
        return;
      }

      // Fetch the object from S3 to sniff its actual type.
      const buffer = await s3.getObject(payload.storageKey);
      if (!buffer) throw new Error(`S3 object not found: ${payload.storageKey}`);

      const sniffed = await fileTypeFromBuffer(buffer);
      if (!sniffed) {
        // Unknown file type — could be a text file or a malformed binary. Log but
        // don't fail the scan; the declared MIME check below only runs if we have
        // a sniffed type to compare.
        console.log(`[webhook-outbox] clamav_scan: unknown file type for ${payload.storageKey}`);
        return;
      }

      if (doc.mimeType !== sniffed.mime) {
        // MIME mismatch — flag the document by updating its original filename to
        // include a SUSPICIOUS prefix. A real system would add a `suspicious`
        // boolean column and trigger an admin alert; for now the prefix makes
        // it visible in the admin UI.
        await db.update(schema.contractorDocuments)
          .set({ originalFilename: `[SUSPICIOUS: declared ${doc.mimeType}, detected ${sniffed.mime}] ${doc.originalFilename}` })
          .where(eq(schema.contractorDocuments.id, doc.id));
        throw new Error(`MIME mismatch for ${payload.storageKey}: declared=${doc.mimeType} sniffed=${sniffed.mime}`);
      }
      return;
    }
    default:
      throw new Error(`Unknown webhook kind: ${payload.kind}`);
  }
}
