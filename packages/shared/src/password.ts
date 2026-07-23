import zxcvbn from 'zxcvbn';
import { loadEnv } from './env';

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

async function sha1HexUpper(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

const breachCache = new Map<string, { result: boolean; cachedAt: number }>();
const CACHE_TTL_MS = 3600_000;

export async function isPasswordBreached(pw: string): Promise<boolean> {
  const env = loadEnv();
  const failOpen = env.NODE_ENV === 'development' || env.NODE_ENV === 'test' || env.HIBP_FAIL_OPEN;

  const cached = breachCache.get(pw);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.result;

  try {
    const sha1 = await sha1HexUpper(pw);
    const prefix = sha1.slice(0, 5), suffix = sha1.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: AbortSignal.timeout(2000),
      headers: { 'Add-Padding': 'true' },
    });
    if (!res.ok) {
      if (failOpen) { breachCache.set(pw, { result: false, cachedAt: Date.now() }); return false; }
      throw new Error('HIBP breach check unavailable');
    }
    const body = await res.text();
    const result = body.split('\n').some(line => line.trim().split(':')[0] === suffix);
    breachCache.set(pw, { result, cachedAt: Date.now() });
    return result;
  } catch (err) {
    breachCache.set(pw, { result: false, cachedAt: Date.now() });
    if (failOpen) return false;

    console.warn('[password] HIBP check failed, failing closed', (err as Error).message);
    throw new Error('Password breach check is currently unavailable. Please try again later.');
  }
}
