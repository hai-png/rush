import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { api } from './api';

type QueuedMutation = { id: string; method: 'POST' | 'PATCH' | 'DELETE'; path: string; body?: unknown; idempotencyKey: string; createdAt: number };
const QUEUE_KEY = 'addisride.offlineQueue';
// FIX (MOB-012): Cap the queue size to prevent unbounded AsyncStorage growth
// (Android default is 6MB). A user who taps "Claim" 1000 times while offline
// would otherwise fill storage and crash the app on the next write.
const MAX_QUEUE_SIZE = 100;

// FIX (FE-005): listener registry for `onAuthRequiredForFlush`. When the
// flush loop hits a 401, it pauses (preserving remaining items) and emits
// this event so the UI can route the user to re-authentication. The
// previous implementation treated 401 as a permanent rejection (status<500
// → drop) — a queued seat-claim made while the session was alive but
// flushed after the JWT expired was silently lost.
type AuthRequiredListener = (info: { item: QueuedMutation; status: number }) => void;
const authRequiredListeners = new Set<AuthRequiredListener>();

export function onAuthRequiredForFlush(fn: AuthRequiredListener): () => void {
  authRequiredListeners.add(fn);
  return () => { authRequiredListeners.delete(fn); };
}

function emitAuthRequired(item: QueuedMutation, status: number) {
  authRequiredListeners.forEach((fn) => {
    try { fn({ item, status }); } catch { /* listener errors must not break the flush loop */ }
  });
}

async function readQueue(): Promise<QueuedMutation[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}
async function writeQueue(queue: QueuedMutation[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/** Generate a stable idempotency key per (method, path, body) so retries
 *  dedupe server-side. The previous implementation used crypto.randomUUID()
 *  per call — every retry sent a different key, defeating idempotency. */
function stableIdempotencyKey(input: { method: string; path: string; body?: unknown }): string {
  const bodyHash = input.body ? JSON.stringify(input.body) : '';
  return `${input.method}:${input.path}:${bodyHash}`;
}

/** Enqueues a write when offline; returns immediately with a "pending sync" marker.
 *  Caller shows optimistic UI + a pending-sync badge per §16. */
export async function enqueueOrSend(input: Omit<QueuedMutation, 'id' | 'createdAt' | 'idempotencyKey'>) {
  const netState = await NetInfo.fetch();
  // FIX (MOB-001): crypto.randomUUID is not available in React Native's
  // default crypto global — it requires the `react-native-get-random-values`
  // polyfill to be imported at the app entry point. Without it, the first
  // offline seat-claim attempt crashes the screen. As a defensive fallback
  // here (defense in depth — the polyfill is also imported in _layout.tsx),
  // generate a UUID-shaped string from Math.random when crypto.randomUUID
  // is unavailable.
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
  // FIX (MOB-012): cap queue size + dedupe by path+body so a user hammering
  // the same control offline doesn't fill storage with duplicate entries.
  if (queue.length >= MAX_QUEUE_SIZE) {
    throw new Error('Offline queue full — cannot queue more mutations');
  }
  const bodyHash = input.body ? JSON.stringify(input.body) : '';
  const existingIdx = queue.findIndex(q => q.path === input.path && (q.body ? JSON.stringify(q.body) : '') === bodyHash);
  if (existingIdx >= 0) return; // already queued — drop the duplicate
  const newId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  queue.push({ ...input, id: newId, createdAt: Date.now() });
  await writeQueue(queue);
}

async function sendMutation(input: Omit<QueuedMutation, 'id' | 'createdAt'>): Promise<{ ok: boolean; status: number }> {
  const headers = { 'Idempotency-Key': input.idempotencyKey };
  // FIX (MOB-002): openapi-fetch does NOT throw on 4xx/5xx — it returns
  // `{ data, error, response }`. The previous implementation relied on
  // throw-on-error, which meant every queued mutation "succeeded" (no
  // exception), incremented `flushed`, and was dropped from the queue —
  // even if the server returned 400/401/403/409. A queued seat-claim that
  // the server permanently rejected was silently lost. Now we inspect the
  // returned `error` field and return a structured result the caller can
  // branch on.
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

/** Flushes queued mutations in FIFO order on reconnect.
 *
 *  FIX (MOB-002): The previous implementation caught errors thrown by
 *  sendMutation, but openapi-fetch never throws on HTTP errors — it returns
 *  `{ data, error }`. So 4xx/5xx responses were treated as success: the
 *  item was incremented as `flushed` and removed from the queue, silently
 *  dropping data the server had permanently rejected. Now sendMutation
 *  returns a structured `{ ok, status }` so we can distinguish:
 *    - ok=true                 → success, drop from queue
 *    - ok=false, status===401  → auth expired: PAUSE, preserve remaining
 *                                items (including this one), emit
 *                                onAuthRequiredForFlush (FE-005)
 *    - ok=false, status<500    → permanent rejection (400/403/409),
 *                                drop from queue (don't retry forever)
 *    - ok=false, status>=500   → transient, keep in queue for next flush
 */
export async function flushQueue(): Promise<{ flushed: number; remaining: number; pausedForAuth: boolean }> {
  const queue = await readQueue();
  const remaining: QueuedMutation[] = [];
  let flushed = 0;
  let pausedForAuth = false;

  // Use for-of so `item` is `QueuedMutation` (not `T | undefined` from
  // `noUncheckedIndexedAccess`). Track index separately for the 401
  // pause-slice (preserve this item AND every item after it).
  let i = 0;
  for (const item of queue) {
    const { ok, status } = await sendMutation(item);
    if (ok) {
      flushed++;
      i++;
      continue;
    }
    if (status === 401) {
      // FE-005: pause — preserve this item AND every item after it. The
      // session is expired; subsequent items would all 401 too. Emit the
      // event so the UI can route to re-auth, then stop the loop.
      remaining.push(...queue.slice(i));
      await writeQueue(remaining);
      emitAuthRequired(item, status);
      pausedForAuth = true;
      return { flushed, remaining: remaining.length, pausedForAuth };
    }
    if (status < 500) {
      // permanent rejection — drop it, don't block the rest of the queue
      i++;
      continue;
    }
    remaining.push(item); // 5xx — retry next time
    i++;
  }
  await writeQueue(remaining);
  return { flushed, remaining: remaining.length, pausedForAuth };
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

/** FE-005: auto-flush when a fresh login lands. Call this once at app root
 *  with the auth store's `subscribe` function. When `accessToken`
 *  transitions from null/old to a new value, attempt a flush — items
 *  queued while offline (or while the previous session was expired) get
 *  delivered under the new session. */
export function subscribeToAuthFlush(
  subscribe: (listener: (state: { accessToken: string | null }, prev: { accessToken: string | null }) => void) => () => void,
) {
  let lastToken: string | null = null;
  let booted = false;
  return subscribe((state) => {
    // Skip the initial hydration emit (prev.accessToken is undefined on
    // first fire). Only react to a real transition INTO a fresh token.
    if (!booted) { booted = true; lastToken = state.accessToken ?? null; return; }
    const newToken = state.accessToken ?? null;
    if (newToken && newToken !== lastToken) {
      // Fresh login (or refresh). Attempt a flush.
      flushQueue().catch(() => {});
    }
    lastToken = newToken;
  });
}
