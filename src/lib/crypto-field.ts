// field-level encryption for sensitive columns (2FA secrets,
// etc.) so that DB read access (admin, backup, SQL injection, CSV export)
// cannot recover the raw secret.
//
// Uses AES-256-GCM with a key derived from AUTH_SECRET via PBKDF2 (100k
// iterations, 32-byte key). The IV is randomly generated per encryption
// and stored alongside the ciphertext: format is "v1:<ivHex>:<ctHex>:<tagHex>".
// GCM provides both confidentiality and integrity — tampering with the
// ciphertext or tag fails decryption.
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { loadEnv } from '@/lib/env';

const ALGO = 'aes-256-gcm';
const KDF_ITERATIONS = 100_000;
const KDF_SALT = 'addis-ride-field-encryption-v1'; // static salt is OK — key is derived from AUTH_SECRET
const VERSION = 'v1';

let cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = loadEnv().AUTH_SECRET;
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
    // Not encrypted (legacy plaintext) — return as-is for backward compat.
    // This allows gradual migration: existing plaintext secrets still work,
    // new writes are encrypted.
    return encrypted;
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
    // Decryption failed (wrong key, tampered ciphertext) — return null so
    // the caller treats it as "no 2FA secret" rather than crashing.
    return null;
  }
}
