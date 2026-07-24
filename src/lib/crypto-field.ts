// Field-level encryption for sensitive columns (2FA secrets, etc.) so that
// DB read access (admin, backup, SQL injection, CSV export) cannot recover the
// raw secret.
//
// Uses AES-256-GCM with a key derived from FIELD_ENCRYPTION_KEY (preferred)
// or AUTH_SECRET (fallback) via PBKDF2 (100k iterations, 32-byte key). The
// IV is randomly generated per encryption and stored alongside the
// ciphertext: format is "v1:<ivHex>:<ctHex>:<tagHex>". GCM provides both
// confidentiality and integrity — tampering with the ciphertext or tag
// fails decryption.
//
// A separate FIELD_ENCRYPTION_KEY allows rotating the JWT signing secret
// (AUTH_SECRET) without invalidating all existing TOTP secrets.
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
  // rotation doesn't invalidate all encrypted TOTP secrets. Fall back to
  // AUTH_SECRET for backward compatibility.
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
    // Previously, an attacker with DB write access could replace a victim's
    // encrypted TOTP secret with a plaintext secret they control, then log in
    // with their own TOTP code. The documented threat model is "DB read access
    // cannot recover the raw secret" — but the old code also gave up integrity
    // on DB write. Now we return null (treated as "no 2FA secret") so the
    // legitimate user is locked out rather than the attacker being let in.
    // Migration path: run a one-time script to encrypt any legacy plaintext
    // values before deploying this change.
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
    // Decryption failed (wrong key, tampered ciphertext) — return null so
    // the caller treats it as "no 2FA secret" rather than crashing.
    return null;
  }
}
