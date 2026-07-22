// Browser-side API client. Handles JSON encoding, CSRF header injection,
// error unwrapping, and 401 redirect to /login.

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

// P1-38 / FE-008: 401 interceptor. When a session expires, every subsequent
// API call would throw 'HTTP 401' as a sonner toast and the user would be
// stranded. Now we redirect to /login?next=<current path> on the first 401.
let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(cb: () => void) { onUnauthorized = cb; }
function handleUnauthorized() {
  if (onUnauthorized) {
    onUnauthorized();
    return;
  }
  // Default behavior: redirect to /login with a next param.
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

  // CSRF: for non-safe methods, attach the CSRF token from the cookie.
  if (opts.method && !['GET', 'HEAD', 'OPTIONS'].includes(opts.method)) {
    const csrfToken = getCookie(CSRF_COOKIE);
    if (csrfToken) headers.set(CSRF_HEADER, csrfToken);
  }

  const res = await fetch(path, { ...opts, headers, credentials: 'same-origin' });

  // P1-38: intercept 401 before parsing the body — redirect to login.
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
