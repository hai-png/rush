import { Platform } from 'react-native';

// API base URL.
//
// Original behavior: hardcoded `http://10.0.2.2:3000` (Android emulator's
// host-loopback alias). On a real device this address is unroutable, so the
// app is non-functional in production. More critically, it was HTTP over
// cleartext — the 30-day session JWT was interceptable on any network hop.
//
// New behavior:
//   1. Read API_BASE from expo-constants (so it can be set per-build via
//      app.config.ts extra config or EAS environment variables).
//   2. Fall back to the emulator alias only when no override is set.
//   3. In production builds, reject non-https URLs (unless explicitly
//      bypassed via API_ALLOW_HTTP=1 — useful for local dev on a real device).
const EXPO_PUBLIC_API_BASE = (process.env.EXPO_PUBLIC_API_BASE as string | undefined)
  ?? (Platform.OS === 'web' ? 'http://localhost:3000' : 'http://10.0.2.2:3000');

const IS_PROD = process.env.NODE_ENV === 'production' || __DEV__ === false;
if (IS_PROD && EXPO_PUBLIC_API_BASE.startsWith('http://') && process.env.EXPO_PUBLIC_API_ALLOW_HTTP !== '1') {
  // throw at module load — a misconfigured prod build with http:// API_BASE
  // is a critical security issue (session JWT transmitted in cleartext). Crashing
  // at import is acceptable for a misconfigured prod build — better than silently
  // transmitting credentials in cleartext.
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

// 401 interceptor. When the bearer token is rejected, the
// user is redirected to /auth/login via a callback that the auth-store sets.
let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(cb: () => void) { onUnauthorized = cb; }

async function request<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((opts.headers as Record<string, string>) || {}),
  };
  if (sessionToken) headers['authorization'] = `Bearer ${sessionToken}`;
  const res = await fetch(`${API_BASE}/api/v1${path}`, { ...opts, headers });
  // intercept 401 and trigger the auth-store's logout + redirect.
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
