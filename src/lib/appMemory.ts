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
