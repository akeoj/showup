import { delKV, getKV, setKV } from './db';

/**
 * State that must outlive the process.
 *
 * iOS evicts a backgrounded standalone web app aggressively — switch to
 * WhatsApp for a minute and coming back is a cold launch at start_url with
 * every bit of React state gone. Android does the same under memory pressure.
 * So the three things a participant would notice losing are written to
 * IndexedDB as they happen, not held in memory and hoped for.
 */

const ROUTE_KEY = 'lastRoute';
const SESSION_KEY = 'activeWorkout';
const RESULT_KEY = 'lastResult';

/** Routes older than this are not worth restoring — it's a new sitting. */
const ROUTE_TTL_MS = 6 * 60 * 60 * 1000;

export interface LastRoute {
  path: string;
  at: number;
}

/**
 * An in-flight workout, written on every counted rep.
 *
 * `base` is the day's total before this session started, so the final number is
 * always `base + reps` — an absolute daily total, which is what makes both the
 * local write and the server upsert idempotent no matter how often it replays.
 */
export interface ActiveWorkout {
  challengeId: string;
  date: string;
  base: number;
  reps: number;
  startedAt: number;
  updatedAt: number;
}

export interface StoredResult {
  challengeId: string;
  count: number;
  total: number;
  target: number;
  at: number;
}

export async function rememberRoute(path: string): Promise<void> {
  await setKV(ROUTE_KEY, { path, at: Date.now() } satisfies LastRoute);
}

/**
 * Where to send the user on a cold launch, or null to stay put.
 *
 * Two routes are deliberately never restored: the camera (relaunching straight
 * into a permission prompt is hostile) and the results screen (its numbers are
 * about a session that has ended). Both fall back to the challenge dashboard,
 * which is where the person actually wanted to be.
 */
export async function routeToRestore(): Promise<string | null> {
  const saved = await getKV<LastRoute>(ROUTE_KEY);
  if (!saved?.path) return null;
  if (Date.now() - saved.at > ROUTE_TTL_MS) return null;

  const path = saved.path;
  if (path === '/' || path.startsWith('/join')) return null;

  const workout = path.match(/^(\/challenge\/[^/]+)\/(workout|results)$/);
  if (workout) return workout[1];

  return path;
}

export async function saveActiveWorkout(w: Omit<ActiveWorkout, 'updatedAt'>): Promise<void> {
  await setKV(SESSION_KEY, { ...w, updatedAt: Date.now() } satisfies ActiveWorkout);
}

export async function getActiveWorkout(): Promise<ActiveWorkout | null> {
  return getKV<ActiveWorkout>(SESSION_KEY);
}

export async function clearActiveWorkout(): Promise<void> {
  await delKV(SESSION_KEY);
}

export async function saveLastResult(r: Omit<StoredResult, 'at'>): Promise<void> {
  await setKV(RESULT_KEY, { ...r, at: Date.now() } satisfies StoredResult);
}

export async function getLastResult(): Promise<StoredResult | null> {
  const r = await getKV<StoredResult>(RESULT_KEY);
  if (!r) return null;
  // A result from days ago is noise, not context.
  return Date.now() - r.at > 24 * 60 * 60 * 1000 ? null : r;
}

// ---------------------------------------------------------------------------
// Timed sessions
// ---------------------------------------------------------------------------

const TIMER_KEY = 'activeTimer';

/**
 * A running (or paused) timer, persisted so it survives the OS killing the app.
 *
 * `runningSince` is a wall-clock timestamp rather than a tick count: if the
 * phone sleeps or the app is evicted for twenty minutes, those twenty minutes
 * really did pass, and a timer that quietly stopped counting would be worse
 * than useless for someone timing an hour of study.
 */
export interface ActiveTimer {
  challengeId: string;
  date: string;
  /** The day's total before this session started, in the challenge's unit. */
  base: number;
  /** Whole seconds banked from earlier paused stretches of this session. */
  accumulatedSec: number;
  /** Epoch ms the current running stretch began, or null when paused. */
  runningSince: number | null;
  updatedAt: number;
}

export async function saveActiveTimer(t: Omit<ActiveTimer, 'updatedAt'>): Promise<void> {
  await setKV(TIMER_KEY, { ...t, updatedAt: Date.now() } satisfies ActiveTimer);
}

export async function getActiveTimer(): Promise<ActiveTimer | null> {
  return getKV<ActiveTimer>(TIMER_KEY);
}

export async function clearActiveTimer(): Promise<void> {
  await delKV(TIMER_KEY);
}

/** Elapsed seconds including the stretch currently running. */
export function timerElapsedSec(t: ActiveTimer, now = Date.now()): number {
  const live = t.runningSince ? Math.max(0, Math.floor((now - t.runningSince) / 1000)) : 0;
  return t.accumulatedSec + live;
}
