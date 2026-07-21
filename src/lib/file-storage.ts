// File storage — saves uploaded files to local disk under UPLOAD_DIR.
// Returns a storage key (relative path) that gets stored in the DB.
// In production, swap saveFile/readFile for S3-compatible storage.

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { loadEnv } from '@/lib/env';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx']);

export class FileUploadError extends Error {
  constructor(message: string) { super(message); this.name = 'FileUploadError'; }
}

export type UploadedFileMeta = {
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
};

function uploadDir(): string {
  const dir = loadEnv().UPLOAD_DIR || './db/uploads';
  return dir;
}

export async function saveFile(
  file: File,
  namespace: string, // e.g. 'contractor-docs'
): Promise<UploadedFileMeta> {
  const env = loadEnv();
  const maxBytes = env.UPLOAD_MAX_BYTES || 10 * 1024 * 1024;

  if (file.size > maxBytes) {
    throw new FileUploadError(`File too large (max ${maxBytes / 1024 / 1024}MB)`);
  }

  // Validate MIME type from the browser's Content-Type. Trust but verify by
  // checking the extension too. A real AV scan would inspect the bytes.
  const ext = extname(file.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new FileUploadError(`File extension "${ext}" not allowed. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`);
  }
  if (file.type && !ALLOWED_MIME.has(file.type)) {
    throw new FileUploadError(`MIME type "${file.type}" not allowed`);
  }

  // Read bytes + compute SHA256.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checksum = createHash('sha256').update(bytes).digest('hex');

  // Storage key: <namespace>/<random-id>.<ext>
  // Use a random UUID for the filename so multiple uploads of the same file
  // don't collide on the storageKey @unique constraint.
  const id = crypto.randomUUID();
  const storageKey = `${namespace}/${id}${ext}`;

  // Ensure the directory exists, then write.
  const fullPath = join(uploadDir(), storageKey);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, bytes);

  return {
    storageKey,
    originalFilename: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    checksumSha256: checksum,
  };
}

export async function readFileBytes(storageKey: string): Promise<Buffer> {
  // Prevent path traversal — storageKey must not contain '..' or start with '/'.
  if (storageKey.includes('..') || storageKey.startsWith('/')) {
    throw new FileUploadError('Invalid storage key');
  }
  const fullPath = join(uploadDir(), storageKey);
  return readFile(fullPath);
}

export async function fileExists(storageKey: string): Promise<boolean> {
  if (storageKey.includes('..') || storageKey.startsWith('/')) return false;
  const fullPath = join(uploadDir(), storageKey);
  try {
    await stat(fullPath);
    return true;
  } catch {
    return false;
  }
}
