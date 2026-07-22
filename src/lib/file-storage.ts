
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, stat, unlink } from 'node:fs/promises';
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
  namespace: string,
): Promise<UploadedFileMeta> {
  const env = loadEnv();
  const maxBytes = env.UPLOAD_MAX_BYTES || 10 * 1024 * 1024;

  if (file.size > maxBytes) {
    throw new FileUploadError(`File too large (max ${maxBytes / 1024 / 1024}MB)`);
  }

  const ext = extname(file.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new FileUploadError(`File extension "${ext}" not allowed. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`);
  }
  if (file.type && !ALLOWED_MIME.has(file.type)) {
    throw new FileUploadError(`MIME type "${file.type}" not allowed`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const checksum = createHash('sha256').update(bytes).digest('hex');

  const id = randomUUID();
  const storageKey = `${namespace}/${id}${ext}`;

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

export async function deleteFile(storageKey: string): Promise<void> {
  if (storageKey.includes('..') || storageKey.startsWith('/')) return;
  const fullPath = join(uploadDir(), storageKey);
  try {
    await unlink(fullPath);
  } catch {
    // Already gone — fine.
  }
}
