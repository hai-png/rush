import createClient from 'openapi-fetch';
import type { paths } from './schema';

export function createAddisRideClient(opts: { baseUrl: string; getToken?: () => string | undefined }) {
  const client = createClient<paths>({ baseUrl: opts.baseUrl });
  client.use({
    onRequest({ request }) {
      const token = opts.getToken?.();
      if (token) request.headers.set('Authorization', `Bearer ${token}`);
      request.headers.set('X-Request-Id', crypto.randomUUID());
      return request;
    },
    async onResponse({ response }) {
      if (response.status === 409) {
        const body = await response.clone().json().catch(() => null);
        if (body?.error?.code === 'TOS_UPDATE_REQUIRED' && typeof window !== 'undefined') {
          window.location.href = '/tos/accept';
        }
      }
      return response;
    },
  });
  return client;
}
export type { paths } from './schema';
