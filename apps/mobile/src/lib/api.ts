import { Platform } from 'react-native';

const API_BASE = Platform.OS === 'web' ? 'http://localhost:3000' : 'http://10.0.2.2:3000';

let sessionToken: string | null = null;

export function setToken(token: string | null) {
  sessionToken = token;
}

export function getToken(): string | null {
  return sessionToken;
}

async function request<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((opts.headers as Record<string, string>) || {}),
  };
  if (sessionToken) headers['authorization'] = `Bearer ${sessionToken}`;
  const res = await fetch(`${API_BASE}/api/v1${path}`, { ...opts, headers });
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
