import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { loadEnv } from '@/lib/env';

const ALGO = 'aes-256-gcm';
const KDF_ITERATIONS = 100_000;
const KDF_SALT = 'addis-ride-field-encryption-v1'; // static salt is OK — key is derived from the secret
const VERSION = 'v1';

let cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  // Prefer a dedicated FIELD_ENCRYPTION_KEY if set so that AUTH_SECRET
  const secret = process.env.FIELD_ENCRYPTION_KEY || loadEnv().AUTH_SECRET;
  cachedKey = pbkdf2Sync(secret, KDF_SALT, KDF_ITERATIONS, 32, 'sha256');
  return cachedKey;
}

export function encryptField(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  const key = getKey();
  const iv = randomBytes(12); // 96-bit IV is recommended for GCM
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('hex')}:${ct.toString('hex')}:${tag.toString('hex')}`;
}

export function decryptField(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  const parts = encrypted.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    // M-1 fix: reject non-v1: prefixed values instead of returning plaintext.
    return null;
  }
  try {
    const key = getKey();
    const iv = Buffer.from(parts[1], 'hex');
    const ct = Buffer.from(parts[2], 'hex');
    const tag = Buffer.from(parts[3], 'hex');
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    return null;
  }
}

