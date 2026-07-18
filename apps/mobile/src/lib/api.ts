import { createAddisRideClient } from '@addis/sdk';
import { useAuthStore } from './auth-store';

export const api = createAddisRideClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL!,
  getToken: () => useAuthStore.getState().accessToken ?? undefined,
});

/** 401 -> attempt refresh -> retry once -> else force logout. Wired into openapi-fetch middleware. */
let refreshing: Promise<boolean> | null = null;
export async function handleUnauthorized(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const res = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/api/v1/auth/refresh`, {
        method: 'POST', headers: { Authorization: `Bearer ${useAuthStore.getState().accessToken}` },
      });
      if (!res.ok) { await useAuthStore.getState().clearAuth(); return false; }
      const { accessToken } = await res.json();
      await useAuthStore.getState().setAuth(accessToken, useAuthStore.getState().role!);
      return true;
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}
