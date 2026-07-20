import { createAddisRideClient } from '@addis/sdk';
import { useAuthStore } from './auth-store';

// Wire handleUnauthorized into the client's onResponse middleware so that
// 401 responses automatically trigger a refresh attempt. The previous
// implementation defined handleUnauthorized but never connected it to the
// client — token refresh never happened, and users got stuck after the
// 30-minute JWT exp.
let refreshing: Promise<boolean> | null = null;

/** 401 -> attempt refresh -> retry once -> else force logout. */
export async function handleUnauthorized(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      // Use a refresh token (the current access token is what's expired).
      // The API's /auth/refresh endpoint verifies the bearer token AND
      // checks the sessions table — but with our fix in identity/service.ts,
      // /auth/refresh now requires the current jti, deletes the old session,
      // and mints a fresh one. So we pass the (possibly-expired) access
      // token; if the session row is still alive (within 30-day DB TTL),
      // refresh succeeds.
      const currentToken = useAuthStore.getState().accessToken;
      if (!currentToken) {
        await useAuthStore.getState().clearAuth();
        return false;
      }
      try {
        const res = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${currentToken}` },
        });
        if (!res.ok) {
          await useAuthStore.getState().clearAuth();
          return false;
        }
        const data = await res.json();
        const newToken = data?.data?.accessToken;
        if (!newToken) {
          await useAuthStore.getState().clearAuth();
          return false;
        }
        await useAuthStore.getState().setAuth(newToken, useAuthStore.getState().role ?? 'rider');
        return true;
      } catch {
        await useAuthStore.getState().clearAuth();
        return false;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

export const api = createAddisRideClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL!,
  getToken: () => useAuthStore.getState().accessToken ?? undefined,
}) as ReturnType<typeof createAddisRideClient> & {
  // FOLLOW-UP 4: the OpenAPI schema only covers routes declared via
  // `.openapi(createRoute())`. Several mobile screens call untyped paths
  // (/dashboard/rider, /trips, /seat-releases, /shuttle-positions, /devices).
  // Cast to a looser signature so TypeScript doesn't reject these calls.
  // The runtime behavior is unchanged — openapi-fetch still sends the request.
  GET: (path: string, opts?: any) => Promise<{ data?: any; error?: any; response: Response }>;
  POST: (path: string, opts?: any) => Promise<{ data?: any; error?: any; response: Response }>;
  PATCH: (path: string, opts?: any) => Promise<{ data?: any; error?: any; response: Response }>;
  DELETE: (path: string, opts?: any) => Promise<{ data?: any; error?: any; response: Response }>;
};

// Install an onResponse hook that catches 401s and triggers refresh.
// openapi-fetch's middleware contract: returning a modified Request from
// onRequest retries the call.
(api as any).use({
  async onResponse({ request, response }: { request: Request; response: Response }) {
    if (response.status === 401) {
      const refreshed = await handleUnauthorized();
      if (refreshed) {
        // Retry the original request with the new token.
        const newToken = useAuthStore.getState().accessToken;
        if (newToken) {
          const headers = new Headers(request.headers);
          headers.set('Authorization', `Bearer ${newToken}`);
          return fetch(new Request(request, { headers }), undefined as any);
        }
      }
    }
    return response;
  },
});
