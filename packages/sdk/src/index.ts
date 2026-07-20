import createClient from 'openapi-fetch';
import type { paths } from './schema';

export type AddisRideClientOptions = {
  baseUrl: string;
  getToken?: () => string | undefined;
  /** FE-008: optional callback fired when a request returns 401 — UNLESS the
   *  401 carries `error.code === 'TWO_FA_REQUIRED'` (which is a flow-control
   *  signal, not a session-expiry signal). The web app wires this to
   *  `signOut({ callbackUrl: '/login?reason=session_expired' })` + React
   *  Query cache clear, debounced so a request storm doesn't trigger N
   *  redirects. The mobile app does NOT wire this (it has its own
   *  token-refresh path in apps/mobile/src/lib/api.ts). */
  onUnauthorized?: (info: { request: Request; response: Response }) => void;
};

export function createAddisRideClient(opts: AddisRideClientOptions) {
  const client = createClient<paths>({ baseUrl: opts.baseUrl });
  client.use({
    onRequest({ request }) {
      const token = opts.getToken?.();
      if (token) request.headers.set('Authorization', `Bearer ${token}`);
      request.headers.set('X-Request-Id', crypto.randomUUID());
      return request;
    },
    async onResponse({ request, response }) {
      if (response.status === 409) {
        const body = await response.clone().json().catch(() => null);
        if (body?.error?.code === 'TOS_UPDATE_REQUIRED' && typeof window !== 'undefined') {
          window.location.href = '/tos/accept';
        }
      }
      // FE-008: surface 401s to the host app, EXCEPT for TWO_FA_REQUIRED
      // (which is a flow-control signal from /api/v1/auth/token — the
      // caller is mid-login and must enter a 6-digit code, not be kicked
      // to the session-expired login screen).
      if (response.status === 401 && opts.onUnauthorized) {
        let code: string | undefined;
        try {
          const body = await response.clone().json();
          code = body?.error?.code;
        } catch {
          // non-JSON 401 (rare) — treat as a normal session-expiry 401.
        }
        if (code !== 'TWO_FA_REQUIRED') {
          try { opts.onUnauthorized({ request, response }); } catch { /* callback errors must not break the response */ }
        }
      }
      return response;
    },
  });
  return client;
}
export type { paths } from './schema';
