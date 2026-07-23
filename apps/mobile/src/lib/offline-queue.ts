import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { Platform } from 'react-native';


const QUEUE_KEY = 'offline-queue';

type QueuedAction = {
  id: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: any;
  timestamp: number;
};

export async function enqueue(method: QueuedAction['method'], path: string, body?: any): Promise<void> {
  const queue = await getQueue();
  queue.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, method, path, body, timestamp: Date.now() });
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function getQueue(): Promise<QueuedAction[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function drainQueue(): Promise<{ processed: number; failed: number }> {
  const queue = await getQueue();
  if (queue.length === 0) return { processed: 0, failed: 0 };
  let processed = 0, failed = 0;
  const remaining: QueuedAction[] = [];
  for (const item of queue) {
    try {
      if (item.method === 'POST') await api.post(item.path, item.body);
      else if (item.method === 'PATCH') await api.patch(item.path, item.body);
      else if (item.method === 'DELETE') await api.del(item.path);
      processed++;
    } catch {
      failed++;
      remaining.push(item);
    }
  }
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  return { processed, failed };
}

export async function getQueueLength(): Promise<number> {
  return (await getQueue()).length;
}

let isOnline = true;
export function getIsOnline(): boolean { return isOnline; }
export function setIsOnline(online: boolean): void {
  if (online && !isOnline) {
    drainQueue().catch(() => {});
  }
  isOnline = online;
}

// Initialize NetInfo listener. Call once from _layout.tsx.
export async function initConnectivity(): Promise<() => void> {
  try {
    const NetInfo = require('@react-native-community/netinfo');
    const unsub = NetInfo.addEventListener((state: any) => {
      setIsOnline(state.isConnected === true && state.isInternetReachable !== false);
    });
    const state = await NetInfo.fetch();
    isOnline = state.isConnected === true && state.isInternetReachable !== false;
    return unsub;
  } catch {
    return () => {};
  }
}

export async function queueOrSend<T = any>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: any,
): Promise<T | { queued: true }> {
  if (!isOnline) {
    await enqueue(method, path, body);
    return { queued: true } as any;
  }
  try {
    if (method === 'POST') return await api.post<T>(path, body);
    if (method === 'PATCH') return await api.patch<T>(path, body);
    return await api.del<T>(path);
  } catch (e) {
    // Network error — check if we're actually offline.
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('Network') || msg.includes('fetch') || msg.includes('connect')) {
      await enqueue(method, path, body);
      return { queued: true } as any;
    }
    throw e;
  }
}
