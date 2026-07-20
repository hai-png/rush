import createClient from 'openapi-fetch';
import type { paths } from './schema';

export type AddisRideClientOptions = {
  baseUrl: string;
  getToken?: () => string | undefined;

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

      if (response.status === 401 && opts.onUnauthorized) {
        let code: string | undefined;
        try {
          const body = await response.clone().json();
          code = body?.error?.code;
        } catch {}
        if (code !== 'TWO_FA_REQUIRED') {
          try { opts.onUnauthorized({ request, response }); } catch {  }
        }
      }
      return response;
    },
  });
  return client;
}
export type { paths } from './schema';
