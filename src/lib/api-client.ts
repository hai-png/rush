import { ensureCsrf } from '@/components/csrf-initializer';

const CSRF_HEADER = 'x-csrf-token';
const CSRF_COOKIE = 'addis-csrf';

function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]!) : null;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(cb: () => void) { onUnauthorized = cb; }
function handleUnauthorized() {
  if (onUnauthorized) {
    onUnauthorized();
    return;
  }
  if (typeof window !== 'undefined') {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}`;
  }
}

export async function apiFetch<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  if (!headers.has('content-type') && opts.body && !(opts.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }

  if (opts.method && !['GET', 'HEAD', 'OPTIONS'].includes(opts.method)) {
    await ensureCsrf();
    const csrfToken = getCookie(CSRF_COOKIE);
    if (csrfToken) headers.set(CSRF_HEADER, csrfToken);
  }

  const res = await fetch(path, { ...opts, headers, credentials: 'same-origin' });

  if (res.status === 401) {
    handleUnauthorized();
    const err = new ApiError(401, 'UNAUTHORIZED', 'Session expired — please sign in again');
    throw err;
  }

  const text = await res.text();
  let body: any = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }

  if (!res.ok) {
    const err = body?.error ?? { code: 'UNKNOWN', message: `HTTP ${res.status}` };
    throw new ApiError(res.status, err.code, err.message, err.requestId);
  }

  return body?.data ?? body;
}

export const api = {
  get: <T = any>(path: string) => apiFetch<T>(path),
  post: <T = any>(path: string, body?: any) => apiFetch<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T = any>(path: string, body?: any) => apiFetch<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T = any>(path: string, body?: any) => apiFetch<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  del: <T = any>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};

