import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadEnv } from '@addis/shared';

const env = loadEnv();
const CURSOR_SECRET = env.NEXTAUTH_SECRET;

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

  if (cursor.length > 1024) return undefined;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString();
    const lastDot = decoded.lastIndexOf('.');
    if (lastDot < 0) return undefined;
    const payload = decoded.slice(0, lastDot);
    const sig = decoded.slice(lastDot + 1);

    const expected = sign(payload);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return undefined;
    }
    const parsed = JSON.parse(payload);
    return typeof parsed.id === 'string' ? parsed.id : undefined;
  } catch {
    return undefined;
  }
}
