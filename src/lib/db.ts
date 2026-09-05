import Dexie, { type Table } from 'dexie';
import type {
  Challenge,
  HistoryRow,
  LeaderboardRow,
  LocalUser,
  LocalWorkout,
  SyncQueueItem,
} from './types';

/** A leaderboard snapshot kept so the board renders instantly and offline. */
export interface CachedLeaderboard {
  challenge_id: string;
  rows: LeaderboardRow[];
  fetched_at: number;
}

export interface CachedHistory {
  challenge_id: string;
  rows: HistoryRow[];
  fetched_at: number;
}

/** Local record of which challenges this device belongs to. */
export interface Membership {
  challenge_id: string;
  nickname: string;
  is_owner: boolean;
  joined_at: number;
}

/**
 * A copy of the Supabase session, mirrored out of localStorage.
 *
 * Anonymous identity is the single point of failure in this product: lose the
 * session and the participant becomes a *different person* with an empty
 * history. localStorage and IndexedDB are evicted by different mechanisms on
 * iOS, so holding the refresh token in both gives the identity two lives
 * instead of one.
 */
export interface SessionMirror {
  id: 'session';
  access_token: string;
  refresh_token: string;
  user_id: string;
  saved_at: number;
}

/**
 * Small durable values that are not entities: the last route, an in-flight
 * workout, the most recent result. React state does not survive iOS killing a
 * backgrounded web app, so anything the user would be upset to lose lives here.
 */
export interface KV {
  key: string;
  value: unknown;
  updated_at: number;
}

class ShowupDB extends Dexie {
  localUser!: Table<LocalUser, string>;
  challenges!: Table<Challenge, string>;
  memberships!: Table<Membership, string>;
  workouts!: Table<LocalWorkout, string>;
  syncQueue!: Table<SyncQueueItem, number>;
  leaderboards!: Table<CachedLeaderboard, string>;
  histories!: Table<CachedHistory, string>;
  session!: Table<SessionMirror, string>;
  kv!: Table<KV, string>;

  constructor() {
    super('showup');
    this.version(1).stores({
      localUser: 'id',
      challenges: 'id, code',
      memberships: 'challenge_id, joined_at',
      workouts: 'key, challenge_id, workout_date, synced',
      syncQueue: '++id, ref, status, next_attempt_at',
      leaderboards: 'challenge_id',
      histories: 'challenge_id',
    });
    // v2 adds the session mirror. Existing stores carry over untouched, so an
    // upgrade never costs anyone their workouts.
    this.version(2).stores({
      session: 'id',
    });
    this.version(3).stores({
      kv: 'key',
    });
  }
}

export const db = new ShowupDB();

export async function getKV<T>(key: string): Promise<T | null> {
  const row = await db.kv.get(key);
  return row ? (row.value as T) : null;
}

export async function setKV(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value, updated_at: Date.now() });
}

export async function delKV(key: string): Promise<void> {
  await db.kv.delete(key);
}

export const workoutKey = (challengeId: string, date: string) => `${challengeId}:${date}`;

export async function getLocalNickname(): Promise<string> {
  const row = await db.localUser.get('me');
  return row?.nickname ?? '';
}

export async function setLocalNickname(nickname: string): Promise<void> {
  const existing = await db.localUser.get('me');
  await db.localUser.put({
    ...existing,
    id: 'me',
    nickname: nickname.trim(),
    updated_at: Date.now(),
  });
}

/** The last user id this device successfully held, session or not. */
export async function getKnownUserId(): Promise<string | null> {
  const row = await db.localUser.get('me');
  return row?.user_id ?? null;
}

export async function setKnownUserId(userId: string): Promise<void> {
  const existing = await db.localUser.get('me');
  await db.localUser.put({
    id: 'me',
    nickname: existing?.nickname ?? '',
    user_id: userId,
    updated_at: Date.now(),
  });
}

export async function saveSessionMirror(m: Omit<SessionMirror, 'id' | 'saved_at'>): Promise<void> {
  await db.session.put({ ...m, id: 'session', saved_at: Date.now() });
}

export async function getSessionMirror(): Promise<SessionMirror | undefined> {
  return db.session.get('session');
}

export async function clearSessionMirror(): Promise<void> {
  await db.session.delete('session');
}

export async function cacheChallenge(challenge: Challenge): Promise<void> {
  await db.challenges.put(challenge);
}

export async function getCachedChallenge(id: string): Promise<Challenge | undefined> {
  return db.challenges.get(id);
}

export async function rememberMembership(m: Membership): Promise<void> {
  await db.memberships.put(m);
}

export async function getMemberships(): Promise<Membership[]> {
  return db.memberships.toArray();
}

export async function getDayCount(challengeId: string, date: string): Promise<number> {
  const row = await db.workouts.get(workoutKey(challengeId, date));
  return row?.count ?? 0;
}

/**
 * Local-first write. The UI reads this immediately; the sync queue catches up
 * whenever the network allows. `count` is always the FINAL total for the day,
 * never a delta — that is what makes a replayed queue item harmless.
 */
export async function saveLocalWorkout(args: {
  challengeId: string;
  date: string;
  count: number;
  source: LocalWorkout['source'];
}): Promise<LocalWorkout> {
  const key = workoutKey(args.challengeId, args.date);
  const row: LocalWorkout = {
    key,
    challenge_id: args.challengeId,
    workout_date: args.date,
    count: args.count,
    source: args.source,
    updated_at: Date.now(),
    synced: false,
  };

  await db.transaction('rw', db.workouts, db.syncQueue, async () => {
    await db.workouts.put(row);

    // Collapse the queue: only the latest total for a given day needs sending.
    const existing = await db.syncQueue.where('ref').equals(key).toArray();
    for (const item of existing) {
      if (item.id != null) await db.syncQueue.delete(item.id);
    }

    await db.syncQueue.add({
      entity: 'workout',
      ref: key,
      payload: {
        challenge_id: args.challengeId,
        workout_date: args.date,
        count: args.count,
        source: args.source,
      },
      created_at: Date.now(),
      retry_count: 0,
      next_attempt_at: 0,
      status: 'pending',
    });
  });

  return row;
}

export async function pendingCount(): Promise<number> {
  return db.syncQueue.count();
}

export async function localHistory(challengeId: string): Promise<LocalWorkout[]> {
  return db.workouts.where('challenge_id').equals(challengeId).reverse().sortBy('workout_date');
}

/** Every locally-held workout, used to re-push history after an identity reset. */
export async function allLocalWorkouts(): Promise<LocalWorkout[]> {
  return db.workouts.toArray();
}
