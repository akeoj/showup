import { db, workoutKey } from './db';
import { isOnline, markOffline, onNetworkChange } from './network';
import { ensureSession, isSupabaseConfigured, supabase } from './supabase';
import type { SyncQueueItem } from './types';

type SyncState = { pending: number; syncing: boolean; lastError: string | null; lastSyncAt: number | null };
type Listener = (s: SyncState) => void;

const listeners = new Set<Listener>();
let state: SyncState = { pending: 0, syncing: false, lastError: null, lastSyncAt: null };

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

export function getSyncState(): SyncState {
  return state;
}

export function onSyncChange(fn: Listener): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

async function refreshPending() {
  setState({ pending: await db.syncQueue.count() });
}

/** Backoff: 2s, 8s, 30s, 2m, 8m, capped at 30m. */
function backoffMs(retry: number): number {
  const table = [2_000, 8_000, 30_000, 120_000, 480_000];
  return table[Math.min(retry, table.length - 1)] ?? 1_800_000;
}

/**
 * Errors that will never succeed on retry — bad date, count over the cap, not
 * a participant. Retrying these forever would keep a poison item at the head
 * of the queue and block everything behind it, so they are dropped and the
 * local row is flagged instead.
 */
function isPermanent(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('out of range') ||
    m.includes('outside the challenge window') ||
    m.includes('future date') ||
    m.includes('not a participant') ||
    m.includes('challenge not found') ||
    m.includes('violates check constraint') ||
    m.includes('row-level security')
  );
}

let running = false;

export async function flushQueue(reason = 'manual'): Promise<void> {
  if (running || !isSupabaseConfigured) return;
  if (!isOnline()) {
    await refreshPending();
    return;
  }

  running = true;
  setState({ syncing: true });

  try {
    const uid = await ensureSession();
    if (!uid) {
      setState({ lastError: 'Not signed in yet' });
      return;
    }

    const now = Date.now();
    const items = (await db.syncQueue.orderBy('next_attempt_at').toArray()).filter(
      (i) => i.next_attempt_at <= now,
    );

    for (const item of items) {
      if (item.id == null) continue;
      const ok = await pushItem(item);
      if (!ok && !isOnline()) break; // Network died mid-flush; stop and wait.
    }

    setState({ lastSyncAt: Date.now(), lastError: null });
  } catch (err) {
    setState({ lastError: err instanceof Error ? err.message : String(err) });
    console.warn(`[showup] sync (${reason}) failed`, err);
  } finally {
    running = false;
    setState({ syncing: false });
    await refreshPending();
  }
}

async function pushItem(item: SyncQueueItem): Promise<boolean> {
  const { challenge_id, workout_date, count, source } = item.payload;

  const { error } = await supabase.rpc('save_workout', {
    p_challenge_id: challenge_id,
    p_workout_date: workout_date,
    p_count: count,
    p_source: source,
  });

  if (!error) {
    await db.transaction('rw', db.syncQueue, db.workouts, async () => {
      if (item.id != null) await db.syncQueue.delete(item.id);
      const key = workoutKey(challenge_id, workout_date);
      const local = await db.workouts.get(key);
      // Only mark synced if the local row still holds the number we just sent;
      // a workout finished during the request stays pending.
      if (local && local.count === count) {
        await db.workouts.put({ ...local, synced: true });
      }
    });
    return true;
  }

  const message = error.message ?? 'unknown error';

  if (isPermanent(message)) {
    console.warn('[showup] dropping unsyncable workout:', message, item.payload);
    if (item.id != null) await db.syncQueue.delete(item.id);
    return true;
  }

  // A network-level failure means navigator.onLine lied to us.
  if (/fetch|network|failed to fetch|timeout/i.test(message)) markOffline();

  const retry = item.retry_count + 1;
  await db.syncQueue.update(item.id!, {
    retry_count: retry,
    last_error: message,
    next_attempt_at: Date.now() + backoffMs(retry),
    status: retry > 8 ? 'failed' : 'pending',
  });
  return false;
}

let started = false;
let timer: number | undefined;

/**
 * Retry triggers, deliberately several: Background Sync support is still
 * uneven across the browsers this app targets, so nothing here depends on it.
 */
export function startSyncManager(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  void refreshPending();
  void flushQueue('startup');

  onNetworkChange((online) => {
    if (online) void flushQueue('online');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushQueue('foreground');
  });

  window.addEventListener('pageshow', () => void flushQueue('pageshow'));

  timer = window.setInterval(() => {
    if (isOnline()) void flushQueue('interval');
  }, 60_000);
}

export function stopSyncManager(): void {
  if (timer) window.clearInterval(timer);
  started = false;
}
