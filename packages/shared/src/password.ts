import bcrypt from 'bcryptjs';

const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

export function validatePasswordShape(pw: string): void {
  if (pw.length < 10) throw new Error('Password must be at least 10 characters');
  if (pw.length > 1000) throw new Error('Password too long');
  if (CONTROL_CHAR_RE.test(pw)) throw new Error('Password contains invalid characters');
}

export async function hashPassword(pw: string, cost = Number(process.env.BCRYPT_COST ?? 12)): Promise<string> {
  validatePasswordShape(pw);
  return bcrypt.hash(pw, cost);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

/** HIBP k-anonymity check. Fail-soft: network error => allow. */
export async function isPasswordBreached(pw: string): Promise<boolean> {
  try {
    const { createHash } = await import('node:crypto');
    const sha1 = createHash('sha1').update(pw).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5), suffix = sha1.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const body = await res.text();
    return body.split('\n').some(line => line.split(':')[0] === suffix);
  } catch {
    return false; // fail-soft
  }
}
