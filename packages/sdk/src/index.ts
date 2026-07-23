import createClient from 'openapi-fetch';
import type { paths } from './schema';

export type AddisRideClientOptions = {
  baseUrl: string;
  getToken?: () => string | undefined;

  onUnauthorized?: (info: { request: Request; response: Response }) => void;
};

type LooseClient = ReturnType<typeof createClient<paths>> & {
  GET: (path: string, opts?: any) => Promise<{ data?: any; error?: any; response: Response }>;
  POST: (path: string, opts?: any) => Promise<{ data?: any; error?: any; response: Response }>;
  PATCH: (path: string, opts?: any) => Promise<{ data?: any; error?: any; response: Response }>;
  PUT: (path: string, opts?: any) => Promise<{ data?: any; error?: any; response: Response }>;
  DELETE: (path: string, opts?: any) => Promise<{ data?: any; error?: any; response: Response }>;
};

export function createAddisRideClient(opts: AddisRideClientOptions): LooseClient {
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
  return client as unknown as LooseClient;
}
export type { paths } from './schema';
