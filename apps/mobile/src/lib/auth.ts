import { api, setToken, getToken } from './api';
import * as SecureStore from 'expo-secure-store';

export async function login(phone: string, password: string, code?: string) {
  const result = await api.post<{ accessToken: string; user: { id: string; role: string; phone: string }; requiresTosAcceptance: boolean }>('/auth/token', { phone, password, code });
  setToken(result.accessToken);
  await SecureStore.setItemAsync('session', result.accessToken);
  return result;
}

export async function logout() {
  try { await api.post('/auth/logout'); } catch {}
  setToken(null);
  await SecureStore.deleteItemAsync('session');
}

export async function restoreSession(): Promise<boolean> {
  const token = await SecureStore.getItemAsync('session');
  if (!token) return false;
  setToken(token);
  try {
    await api.get('/auth/me');
    return true;
  } catch {
    setToken(null);
    await SecureStore.deleteItemAsync('session');
    return false;
  }
}
