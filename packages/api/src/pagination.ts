import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadEnv } from '@addis/shared';

const env = loadEnv();
const CURSOR_SECRET = env.NEXTAUTH_SECRET; // reuse the app's main HMAC secret

// HMAC-sign the cursor so a client can't forge or tamper with it. The
// previous implementation was `Buffer.from(JSON.stringify({id})).toString('base64url')`
// — unsigned, so anyone could craft a cursor pointing at any id (including
// ones they shouldn't know about) and scan the table. Now the cursor
// includes an HMAC tag; tampering is rejected.
function sign(payload: string): string {
  return createHmac('sha256', CURSOR_SECRET).update(payload).digest('hex');
}

export function encodeCursor(id: string): string {
  const payload = JSON.stringify({ id });
  const sig = sign(payload);
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

export function decodeCursor(cursor?: string): string | undefined {
  if (!cursor) return undefined;
  // Length cap: a multi-MB cursor shouldn't trigger a base64 decode + JSON
  // parse. The previous implementation had no cap — DoS vector.
  if (cursor.length > 1024) return undefined;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString();
    const lastDot = decoded.lastIndexOf('.');
    if (lastDot < 0) return undefined;
    const payload = decoded.slice(0, lastDot);
    const sig = decoded.slice(lastDot + 1);
    // Constant-time comparison to avoid timing-based signature oracle.
    const expected = sign(payload);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return undefined; // tampered or wrong key — treat as no cursor
    }
    const parsed = JSON.parse(payload);
    return typeof parsed.id === 'string' ? parsed.id : undefined;
  } catch {
    return undefined;
  }
}
