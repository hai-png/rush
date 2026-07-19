import { fileTypeFromBuffer } from 'file-type';
import { createHash } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { BadRequestError, NotFoundError, ConflictError } from '@addis/shared';
import { s3 } from '../../infra/s3';
import { contractorVerificationState } from './contractor-state';

const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const DOC_TYPES = ['registration', 'insurance', 'inspection'] as const;

export const documentService = {
  async upload(contractorId: string, input: { type: (typeof DOC_TYPES)[number]; filename: string; buffer: Buffer }) {
    if (input.buffer.byteLength > MAX_SIZE_BYTES) throw new BadRequestError('File exceeds 10MB limit');

    // Never trust client-declared MIME — sniff magic bytes
    const sniffed = await fileTypeFromBuffer(input.buffer);
    const mimeType = sniffed?.mime ?? 'application/octet-stream';
    if (!ALLOWED_MIME.has(mimeType)) throw new BadRequestError('Only PDF, JPEG, PNG allowed');

    const checksum = createHash('sha256').update(input.buffer).digest('hex');

    // Dedupe by checksum within this contractor's docs of the same type
    const [dup] = await db.select().from(schema.contractorDocuments)
      .where(and(eq(schema.contractorDocuments.contractorId, contractorId), eq(schema.contractorDocuments.checksumSha256, checksum)));
    if (dup) return dup;

    const storageKey = `contractors/${contractorId}/${input.type}/${checksum}`;
    await s3.putObject(storageKey, input.buffer, mimeType);

    // Async malware scan via outbox — does not block upload response
    const [doc] = await db.transaction(async (tx) => {
      const inserted = await tx.insert(schema.contractorDocuments).values({
        contractorId, type: input.type, originalFilename: input.filename,
        storageKey, mimeType, sizeBytes: input.buffer.byteLength, checksumSha256: checksum,
      }).returning();
      await tx.insert(schema.outboxEvents).values({ channel: 'webhook', payload: { kind: 'clamav_scan', storageKey } });

      // First document submission moves unverified -> pending
      const [profile] = await tx.select().from(schema.contractorProfiles).where(eq(schema.contractorProfiles.id, contractorId));
      if (profile?.verificationStatus === 'unverified') {
        const t = contractorVerificationState.resolve('unverified', 'documents.submitted');
        await tx.update(schema.contractorProfiles).set({ verificationStatus: t.to, updatedAt: new Date() }).where(eq(schema.contractorProfiles.id, contractorId));
      } else if (profile?.verificationStatus === 'rejected') {
        const t = contractorVerificationState.resolve('rejected', 'documents.resubmitted');
        await tx.update(schema.contractorProfiles).set({ verificationStatus: t.to, verificationReason: null, updatedAt: new Date() }).where(eq(schema.contractorProfiles.id, contractorId));
      }
      return inserted;
    });
    return doc;
  },

  async list(contractorId: string) {
    return db.select().from(schema.contractorDocuments).where(eq(schema.contractorDocuments.contractorId, contractorId));
  },

  async remove(requesterContractorId: string | null, documentId: string) {
    const [doc] = await db.select().from(schema.contractorDocuments).where(eq(schema.contractorDocuments.id, documentId));
    if (!doc) throw new NotFoundError('Document not found');
    if (requesterContractorId !== null && doc.contractorId !== requesterContractorId) throw new NotFoundError('Document not found');
    await db.delete(schema.contractorDocuments).where(eq(schema.contractorDocuments.id, documentId));
    await s3.deleteObject(doc.storageKey);
  },

  /**
   * `requesterContractorId` is the caller's own contractor profile id, or `null` for a
   * platform_admin who is allowed to view any contractor's documents. A non-admin caller
   * must own the document — otherwise this is an IDOR (any contractor could otherwise read
   * any other contractor's license/insurance/inspection files by guessing/enumerating ids).
   */
  async signedDownloadUrl(documentId: string, requesterContractorId: string | null) {
    const [doc] = await db.select().from(schema.contractorDocuments).where(eq(schema.contractorDocuments.id, documentId));
    if (!doc) throw new NotFoundError('Document not found');
    if (requesterContractorId !== null && doc.contractorId !== requesterContractorId) {
      throw new NotFoundError('Document not found'); // 404, not 403 — avoid confirming existence to non-owners
    }
    return s3.presignGet(doc.storageKey, 15 * 60);
  },

  async verify(adminId: string, contractorId: string) {
    return db.transaction(async (tx) => {
      const [profile] = await tx.select().from(schema.contractorProfiles).where(eq(schema.contractorProfiles.id, contractorId));
      if (!profile) throw new NotFoundError('Contractor not found');
      if (profile.verificationStatus !== 'pending') throw new ConflictError('Only pending contractors can be verified');
      const t = contractorVerificationState.resolve('pending', 'admin.verify');
      await tx.update(schema.contractorProfiles).set({
        verificationStatus: t.to, verifiedById: adminId, verifiedAt: new Date(), updatedAt: new Date(),
      }).where(eq(schema.contractorProfiles.id, contractorId));
      await tx.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'document_verified', userId: profile.userId } });
      return t;
    });
  },

  async reject(adminId: string, contractorId: string, reason: string) {
    return db.transaction(async (tx) => {
      const [profile] = await tx.select().from(schema.contractorProfiles).where(eq(schema.contractorProfiles.id, contractorId));
      if (!profile) throw new NotFoundError('Contractor not found');
      if (profile.verificationStatus !== 'pending') throw new ConflictError('Only pending contractors can be rejected');
      const t = contractorVerificationState.resolve('pending', 'admin.reject');
      await tx.update(schema.contractorProfiles).set({
        verificationStatus: t.to, verificationReason: reason, verifiedById: adminId, verifiedAt: new Date(), updatedAt: new Date(),
      }).where(eq(schema.contractorProfiles.id, contractorId));
      await tx.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'document_rejected', userId: profile.userId, reason } });
      return t;
    });
  },
};
