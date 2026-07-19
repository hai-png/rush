import bcrypt from 'bcryptjs';
import { loadEnv } from './env';

const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

// Bcrypt truncates passwords at 72 bytes — anything longer is silently
// ignored. A user with a 1000-char password believes they have 1000 chars
// of security, but only the first 72 bytes matter. Cap the input.
const BCRYPT_MAX_BYTES = 72;

export function validatePasswordShape(pw: string): void {
  if (pw.length < 10) throw new Error('Password must be at least 10 characters');
  if (pw.length > 72) throw new Error(`Password too long — bcrypt only considers the first ${BCRYPT_MAX_BYTES} bytes`);
  // Reject control characters (NEL, BEL, etc.) — invisible but cause
  // subtle bugs in display, copy-paste, and logging.
  if (CONTROL_CHAR_RE.test(pw)) throw new Error('Password contains invalid characters');
}

export async function hashPassword(pw: string, cost?: number): Promise<string> {
  validatePasswordShape(pw);
  // Read cost from validated env — the previous implementation read
  // process.env.BCRYPT_COST directly with no validation, so BCRYPT_COST=0
  // or BCRYPT_COST=4 would silently weaken every hash. The env schema now
  // requires cost >= 10 and <= 15.
  const env = loadEnv();
  const actualCost = cost ?? env.BCRYPT_COST;
  if (actualCost < 10 || actualCost > 15) {
    throw new Error(`Invalid bcrypt cost ${actualCost} — must be between 10 and 15`);
  }
  return bcrypt.hash(pw, actualCost);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  // Defensive: a malformed hash causes bcrypt.compare to throw — turn it
  // into a clean false so the caller can treat it as "wrong password"
  // rather than crashing with a 500.
  try {
    return await bcrypt.compare(pw, hash);
  } catch {
    return false;
  }
}

/**
 * HIBP k-anonomity breach check.
 *
 * Previously failed OPEN on network error — an attacker who could block
 * outbound DNS to api.pwnedpasswords.com (DNS poisoning, network
 * segmentation) would bypass the breach check entirely. Now we fail
 * CLOSED in production (reject the password) and OPEN in dev/test (so
 * local development doesn't require HIBP reachability).
 */
export async function isPasswordBreached(pw: string): Promise<boolean> {
  const env = loadEnv();
  const failOpen = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  try {
    const { createHash } = await import('node:crypto');
    const sha1 = createHash('sha1').update(pw).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5), suffix = sha1.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: AbortSignal.timeout(2000),
      headers: { 'Add-Padding': 'true' }, // HIBP rate-limits unpadded requests more aggressively
    });
    if (!res.ok) {
      // 429 / 5xx from HIBP — fail closed in prod (safer to reject a
      // potentially-breached password than to accept it).
      if (failOpen) return false;
      throw new Error('HIBP breach check unavailable');
    }
    const body = await res.text();
    return body.split('\n').some(line => line.trim().split(':')[0] === suffix);
  } catch (err) {
    if (failOpen) return false;
    // In production, surface the error so the caller can decide — but
    // default to rejecting the password.
    console.warn('[password] HIBP check failed, failing closed', (err as Error).message);
    throw new Error('Password breach check is currently unavailable. Please try again later.');
  }
}
