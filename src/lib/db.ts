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

class ShowupDB extends Dexie {
  localUser!: Table<LocalUser, string>;
  challenges!: Table<Challenge, string>;
  memberships!: Table<Membership, string>;
  workouts!: Table<LocalWorkout, string>;
  syncQueue!: Table<SyncQueueItem, number>;
  leaderboards!: Table<CachedLeaderboard, string>;
  histories!: Table<CachedHistory, string>;

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
  }
}

export const db = new ShowupDB();

export const workoutKey = (challengeId: string, date: string) => `${challengeId}:${date}`;

export async function getLocalNickname(): Promise<string> {
  const row = await db.localUser.get('me');
  return row?.nickname ?? '';
}

export async function setLocalNickname(nickname: string): Promise<void> {
  await db.localUser.put({ id: 'me', nickname: nickname.trim(), updated_at: Date.now() });
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
