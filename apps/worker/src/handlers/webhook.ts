import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { s3 } from '@addis/api/infra/s3';
import { fileTypeFromBuffer } from 'file-type';

export async function handle(
  payload: { kind: string; storageKey?: string; [k: string]: unknown },
  _evt?: typeof schema.outboxEvents.$inferSelect,
) {
  switch (payload.kind) {
    case 'clamav_scan': {
      if (!payload.storageKey) throw new Error('clamav_scan payload missing storageKey');

      const [doc] = await db.select().from(schema.contractorDocuments)
        .where(eq(schema.contractorDocuments.storageKey, payload.storageKey));
      if (!doc) {

        return;
      }

      const buffer = await s3.getObject(payload.storageKey);
      if (!buffer) throw new Error(`S3 object not found: ${payload.storageKey}`);

      const sniffed = await fileTypeFromBuffer(buffer);
      if (!sniffed) {

        console.log(`[webhook-outbox] clamav_scan: unknown file type for ${payload.storageKey}`);
        return;
      }

      if (doc.mimeType !== sniffed.mime) {

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
