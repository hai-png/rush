import { Platform } from 'react-native';

// API base URL — read from EXPO_PUBLIC_API_BASE so it can vary per build
// (EAS env vars or app.config.ts extra). Falls back to the Android emulator
// alias. Production builds reject http:// (cleartext JWT) unless
// EXPO_PUBLIC_API_ALLOW_HTTP=1.
const EXPO_PUBLIC_API_BASE = (process.env.EXPO_PUBLIC_API_BASE as string | undefined)
  ?? (Platform.OS === 'web' ? 'http://localhost:3000' : 'http://10.0.2.2:3000');

const IS_PROD = process.env.NODE_ENV === 'production' || __DEV__ === false;
if (IS_PROD && EXPO_PUBLIC_API_BASE.startsWith('http://') && process.env.EXPO_PUBLIC_API_ALLOW_HTTP !== '1') {
  // Crashing at import for a misconfigured prod build is preferable to silently
  // transmitting the session JWT in cleartext.
  throw new Error(
    '[api] API_BASE is http:// in a production build. Set EXPO_PUBLIC_API_BASE to an https:// URL ' +
    '(or set EXPO_PUBLIC_API_ALLOW_HTTP=1 to bypass — NOT recommended).'
  );
}

export const API_BASE = EXPO_PUBLIC_API_BASE;

let sessionToken: string | null = null;

export function setToken(token: string | null) {
  sessionToken = token;
}

export function getToken(): string | null {
  return sessionToken;
}

// 401 interceptor — on token rejection, triggers the auth-store's logout + redirect.
let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(cb: () => void) { onUnauthorized = cb; }

async function request<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((opts.headers as Record<string, string>) || {}),
  };
  if (sessionToken) headers['authorization'] = `Bearer ${sessionToken}`;
  const res = await fetch(`${API_BASE}/api/v1${path}`, { ...opts, headers });
  if (res.status === 401) {
    if (onUnauthorized) onUnauthorized();
    throw new Error('Session expired — please sign in again');
  }
  const text = await res.text();
  let body: any = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  return body?.data ?? body;
}

export const api = {
  get: <T = any>(path: string) => request<T>(path),
  post: <T = any>(path: string, body?: any) => request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T = any>(path: string, body?: any) => request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  del: <T = any>(path: string) => request<T>(path, { method: 'DELETE' }),
};
