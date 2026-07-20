import zxcvbn from 'zxcvbn';
import { loadEnv } from './env';

// Edge-runtime compatibility:
//   - `bcryptjs` is loaded lazily via dynamic `import()` so it is NOT pulled
//     into the client bundle. The functions that use it (`hashPassword`,
//     `verifyPassword`) are server-only, but the pure helpers
//     (`scorePasswordStrength`, `validatePasswordShape`) are safe to use
//     client-side (e.g. in a signup form for live strength feedback).
//   - `node:crypto` is replaced with Web Crypto (`crypto.subtle`) for the
//     HIBP SHA-1 hash. Web Crypto is available in both Node.js (>= 15)
//     and the Edge Runtime, so the same code works everywhere.

const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

const MIN_ZXCVBN_SCORE = 3;

export function scorePasswordStrength(pw: string): { score: number; feedback: string[] } {
  const result = zxcvbn(pw);
  const feedback: string[] = [];
  if (result.feedback.warning) feedback.push(result.feedback.warning);
  if (result.feedback.suggestions) feedback.push(...result.feedback.suggestions);
  return { score: result.score, feedback };
}

export function validatePasswordShape(pw: string): void {
  if (pw.length < 10) throw new Error('Password must be at least 10 characters');
  if (pw.length > 100) throw new Error('Password must be at most 100 characters');

  if (CONTROL_CHAR_RE.test(pw)) throw new Error('Password contains invalid characters');
  const { score, feedback } = scorePasswordStrength(pw);
  if (score < MIN_ZXCVBN_SCORE) {
    const msg = feedback.length > 0 ? feedback.join(' ') : 'Password is too weak — try adding length, variety, or avoiding common patterns';
    throw new Error(msg);
  }
}

export async function hashPassword(pw: string, cost?: number): Promise<string> {
  validatePasswordShape(pw);

  const env = loadEnv();
  const actualCost = cost ?? env.BCRYPT_COST;
  if (actualCost < 10 || actualCost > 15) {
    throw new Error(`Invalid bcrypt cost ${actualCost} — must be between 10 and 15`);
  }
  // Lazy-load bcryptjs so it's never bundled into client code.
  const { default: bcrypt } = await import('bcryptjs');
  return bcrypt.hash(pw, actualCost);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {

  try {
    const { default: bcrypt } = await import('bcryptjs');
    return await bcrypt.compare(pw, hash);
  } catch {
    return false;
  }
}

// Web Crypto-based SHA-1 for the HIBP k-anonymity check. Works on both
// Node.js and Edge Runtime (no `node:crypto` dependency).
async function sha1HexUpper(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export async function isPasswordBreached(pw: string): Promise<boolean> {
  const env = loadEnv();
  const failOpen = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  try {
    const sha1 = await sha1HexUpper(pw);
    const prefix = sha1.slice(0, 5), suffix = sha1.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: AbortSignal.timeout(2000),
      headers: { 'Add-Padding': 'true' },
    });
    if (!res.ok) {

      if (failOpen) return false;
      throw new Error('HIBP breach check unavailable');
    }
    const body = await res.text();
    return body.split('\n').some(line => line.trim().split(':')[0] === suffix);
  } catch (err) {
    if (failOpen) return false;

    console.warn('[password] HIBP check failed, failing closed', (err as Error).message);
    throw new Error('Password breach check is currently unavailable. Please try again later.');
  }
}
