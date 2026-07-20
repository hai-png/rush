import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { api } from './api';

type QueuedMutation = { id: string; method: 'POST' | 'PATCH' | 'DELETE'; path: string; body?: unknown; idempotencyKey: string; createdAt: number };
const QUEUE_KEY = 'addisride.offlineQueue';

const MAX_QUEUE_SIZE = 100;

type AuthRequiredListener = (info: { item: QueuedMutation; status: number }) => void;
const authRequiredListeners = new Set<AuthRequiredListener>();

export function onAuthRequiredForFlush(fn: AuthRequiredListener): () => void {
  authRequiredListeners.add(fn);
  return () => { authRequiredListeners.delete(fn); };
}

function emitAuthRequired(item: QueuedMutation, status: number) {
  authRequiredListeners.forEach((fn) => {
    try { fn({ item, status }); } catch {  }
  });
}

async function readQueue(): Promise<QueuedMutation[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}
async function writeQueue(queue: QueuedMutation[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

function stableIdempotencyKey(input: { method: string; path: string; body?: unknown }): string {
  const bodyHash = input.body ? JSON.stringify(input.body) : '';
  return `${input.method}:${input.path}:${bodyHash}`;
}

export async function enqueueOrSend(input: Omit<QueuedMutation, 'id' | 'createdAt' | 'idempotencyKey'>) {
  const netState = await NetInfo.fetch();

  const idempotencyKey = stableIdempotencyKey(input);

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

  if (queue.length >= MAX_QUEUE_SIZE) {
    throw new Error('Offline queue full — cannot queue more mutations');
  }
  const bodyHash = input.body ? JSON.stringify(input.body) : '';
  const existingIdx = queue.findIndex(q => q.path === input.path && (q.body ? JSON.stringify(q.body) : '') === bodyHash);
  if (existingIdx >= 0) return;
  const newId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  queue.push({ ...input, id: newId, createdAt: Date.now() });
  await writeQueue(queue);
}

async function sendMutation(input: Omit<QueuedMutation, 'id' | 'createdAt'>): Promise<{ ok: boolean; status: number }> {
  const headers = { 'Idempotency-Key': input.idempotencyKey };

  let res: { data?: unknown; error?: unknown; response?: { status: number } };
  if (input.method === 'POST') {
    res = await api.POST(input.path as any, { body: input.body as any, headers } as any) as any;
  } else if (input.method === 'PATCH') {
    res = await api.PATCH(input.path as any, { body: input.body as any, headers } as any) as any;
  } else {
    res = await api.DELETE(input.path as any, { headers } as any) as any;
  }
  const status = res.response?.status ?? 0;
  return { ok: !res.error, status };
}

export async function flushQueue(): Promise<{ flushed: number; remaining: number; pausedForAuth: boolean }> {
  const queue = await readQueue();
  const remaining: QueuedMutation[] = [];
  let flushed = 0;
  let pausedForAuth = false;

  let i = 0;
  for (const item of queue) {
    const { ok, status } = await sendMutation(item);
    if (ok) {
      flushed++;
      i++;
      continue;
    }
    if (status === 401) {

      remaining.push(...queue.slice(i));
      await writeQueue(remaining);
      emitAuthRequired(item, status);
      pausedForAuth = true;
      return { flushed, remaining: remaining.length, pausedForAuth };
    }
    if (status < 500) {

      i++;
      continue;
    }
    remaining.push(item);
    i++;
  }
  await writeQueue(remaining);
  return { flushed, remaining: remaining.length, pausedForAuth };
}

export async function pendingCount(): Promise<number> {
  return (await readQueue()).length;
}

export function subscribeToConnectivity() {
  return NetInfo.addEventListener((state) => {
    if (state.isConnected) flushQueue().catch(() => {});
  });
}

export function subscribeToAuthFlush(
  subscribe: (listener: (state: { accessToken: string | null }, prev: { accessToken: string | null }) => void) => () => void,
) {
  let lastToken: string | null = null;
  let booted = false;
  return subscribe((state) => {

    if (!booted) { booted = true; lastToken = state.accessToken ?? null; return; }
    const newToken = state.accessToken ?? null;
    if (newToken && newToken !== lastToken) {

      flushQueue().catch(() => {});
    }
    lastToken = newToken;
  });
}
