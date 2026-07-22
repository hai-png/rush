import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

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
  queue.push({ id: Date.now().toString(), method, path, body, timestamp: Date.now() });
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function getQueue(): Promise<QueuedAction[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function drainQueue(): Promise<{ processed: number; failed: number }> {
  const queue = await getQueue();
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
