import { createAddisRideClient } from '@addis/sdk';
import { useAuthStore } from './auth-store';

let refreshing: Promise<boolean> | null = null;

export async function handleUnauthorized(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {

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

  GET: (path: string, opts?: any) => Promise<{ data?: any; error?: any; response: Response }>;
  POST: (path: string, opts?: any) => Promise<{ data?: any; error?: any; response: Response }>;
  PATCH: (path: string, opts?: any) => Promise<{ data?: any; error?: any; response: Response }>;
  DELETE: (path: string, opts?: any) => Promise<{ data?: any; error?: any; response: Response }>;
};

(api as any).use({
  async onResponse({ request, response }: { request: Request; response: Response }) {
    if (response.status === 401) {
      const refreshed = await handleUnauthorized();
      if (refreshed) {

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
