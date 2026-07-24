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

// M-5 fix: magic-byte validation for uploaded files. Prevents MIME/extension
function validateMagicBytes(bytes: Uint8Array, ext: string): string | null {
  if (bytes.length < 4) return 'File too small';
  const sig = Array.from(bytes.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
  const checks: Record<string, string[]> = {
    '.pdf': ['25504446'],  // %PDF
    '.jpg': ['ffd8ff'],
    '.jpeg': ['ffd8ff'],
    '.png': ['89504e47'],
    '.webp': ['52494646'],  // RIFF....WEBP
    '.doc': ['d0cf11e0'],  // OLE2 compound document
    '.docx': ['504b0304'],  // ZIP (OOXML is ZIP-based)
  };
  const expected = checks[ext];
  if (!expected) return null;  // no check for this extension
  const ok = expected.some(prefix => sig.startsWith(prefix));
  return ok ? null : `File content does not match extension "${ext}" (magic bytes mismatch)`;
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
  const mimeType = file.type || 'application/octet-stream';
  if (!ALLOWED_MIME.has(mimeType)) {
    throw new FileUploadError(`MIME type "${mimeType}" not allowed. Allowed: ${[...ALLOWED_MIME].join(', ')}`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const checksum = createHash('sha256').update(bytes).digest('hex');

  // M-5 fix: validate magic bytes so a renamed HTML file can't pass as a PDF.
  const magicError = validateMagicBytes(bytes, ext);
  if (magicError) {
    throw new FileUploadError(magicError);
  }

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
  }
}

