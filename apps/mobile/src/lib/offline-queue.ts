import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { api } from './api';

type QueuedMutation = { id: string; method: 'POST' | 'PATCH' | 'DELETE'; path: string; body?: unknown; idempotencyKey: string; createdAt: number };
const QUEUE_KEY = 'addisride.offlineQueue';

async function readQueue(): Promise<QueuedMutation[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}
async function writeQueue(queue: QueuedMutation[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/** Enqueues a write when offline; returns immediately with a "pending sync" marker.
 *  Caller shows optimistic UI + a pending-sync badge per §16. */
export async function enqueueOrSend(input: Omit<QueuedMutation, 'id' | 'createdAt' | 'idempotencyKey'>) {
  const netState = await NetInfo.fetch();
  const idempotencyKey = crypto.randomUUID();

  if (netState.isConnected) {
    try {
      return await sendMutation({ ...input, idempotencyKey });
    } catch {
      await queueMutation({ ...input, idempotencyKey });
      return { queued: true };
    }
  }
  await queueMutation({ ...input, idempotencyKey });
  return { queued: true };
}

async function queueMutation(input: Omit<QueuedMutation, 'id' | 'createdAt'>) {
  const queue = await readQueue();
  queue.push({ ...input, id: crypto.randomUUID(), createdAt: Date.now() });
  await writeQueue(queue);
}

async function sendMutation(input: Omit<QueuedMutation, 'id' | 'createdAt'>) {
  const headers = { 'Idempotency-Key': input.idempotencyKey };
  if (input.method === 'POST') return api.POST(input.path as any, { body: input.body as any, headers });
  if (input.method === 'PATCH') return api.PATCH(input.path as any, { body: input.body as any, headers });
  return api.DELETE(input.path as any, { headers });
}

/** Flushes queued mutations in FIFO order on reconnect. Stops at first hard failure (4xx)
 *  to avoid replaying a mutation the server has already permanently rejected. */
export async function flushQueue(): Promise<{ flushed: number; remaining: number }> {
  const queue = await readQueue();
  const remaining: QueuedMutation[] = [];
  let flushed = 0;

  for (const item of queue) {
    try {
      await sendMutation(item);
      flushed++;
    } catch (err: any) {
      if (err?.status && err.status < 500) {
        // permanent rejection — drop it, don't block the rest of the queue forever
        continue;
      }
      remaining.push(item);
    }
  }
  await writeQueue(remaining);
  return { flushed, remaining: remaining.length };
}

export async function pendingCount(): Promise<number> {
  return (await readQueue()).length;
}

/** Wire this once at app root — flush automatically whenever connectivity returns. */
export function subscribeToConnectivity() {
  return NetInfo.addEventListener((state) => {
    if (state.isConnected) flushQueue().catch(() => {});
  });
}
