import {
  allLocalWorkouts,
  cacheChallenge,
  db,
  getCachedChallenge,
  getMemberships,
  getLocalNickname,
  rememberMembership,
  saveLocalWorkout,
  setLocalNickname,
  workoutKey,
} from '@/lib/db';
import { isOnline } from '@/lib/network';
import { ensureSession, isSupabaseConfigured, supabase } from '@/lib/supabase';
import { flushQueue } from '@/lib/sync';
import { todayInZone } from '@/lib/dates';
import type {
  Challenge,
  ChallengePreview,
  HistoryRow,
  LeaderboardRow,
  MyChallenge,
  Participant,
  PublicChallenge,
  Visibility,
  WorkoutSource,
} from '@/lib/types';

export class OfflineError extends Error {
  constructor(message = "You're offline. This needs a connection.") {
    super(message);
    this.name = 'OfflineError';
  }
}

export class NotConfiguredError extends Error {
  constructor() {
    super('Supabase is not configured. Copy .env.example to .env.local and add your keys.');
    this.name = 'NotConfiguredError';
  }
}

function assertOnline() {
  if (!isSupabaseConfigured) throw new NotConfiguredError();
  if (!isOnline()) throw new OfflineError();
}

export interface CreateChallengeInput {
  name: string;
  activity_type: string;
  tracking_mode: 'cv' | 'manual';
  unit: string;
  daily_target: number;
  start_date: string;
  end_date: string;
  visibility: Visibility;
  timezone: string;
  nickname: string;
  description?: string;
}

export async function createChallenge(input: CreateChallengeInput): Promise<Challenge> {
  assertOnline();
  await ensureSession();

  const { data, error } = await supabase.rpc('create_challenge', {
    p_name: input.name,
    p_activity_type: input.activity_type,
    p_tracking_mode: input.tracking_mode,
    p_unit: input.unit,
    p_daily_target: input.daily_target,
    p_start_date: input.start_date,
    p_end_date: input.end_date,
    p_visibility: input.visibility,
    p_timezone: input.timezone,
    p_nickname: input.nickname,
    p_description: input.description ?? null,
  });

  if (error) throw new Error(error.message);
  const challenge = data as Challenge;

  await Promise.all([
    cacheChallenge(challenge),
    setLocalNickname(input.nickname),
    rememberMembership({
      challenge_id: challenge.id,
      nickname: input.nickname,
      is_owner: true,
      joined_at: Date.now(),
    }),
  ]);

  return challenge;
}

export async function getChallengeByCode(code: string): Promise<ChallengePreview | null> {
  assertOnline();
  await ensureSession();

  const { data, error } = await supabase.rpc('get_challenge_by_code', {
    p_code: code.trim().toUpperCase(),
  });

  if (error) throw new Error(error.message);
  const row = (data as ChallengePreview[])?.[0];
  return row ?? null;
}

/**
 * Turn the join preview into a cacheable challenge row.
 *
 * The preview already carries every field the dashboard needs, so caching it
 * means landing on the challenge page never depends on a second round trip
 * succeeding — which is exactly the trip that fails on a bad connection right
 * after someone taps Join.
 */
export function challengeFromPreview(p: ChallengePreview): Challenge {
  return {
    id: p.id,
    name: p.name,
    code: p.code,
    activity_type: p.activity_type,
    tracking_mode: p.tracking_mode,
    unit: p.unit,
    daily_target: p.daily_target,
    start_date: p.start_date,
    end_date: p.end_date,
    visibility: p.visibility,
    timezone: p.timezone,
    description: p.description,
  };
}

/** Cache a challenge we already have in hand, without asking the server. */
export async function seedChallengeCache(challenge: Challenge): Promise<void> {
  await cacheChallenge(challenge);
}

export async function joinChallenge(
  code: string,
  nickname: string,
  /** Everything we already know about the challenge, cached before navigating. */
  seed?: Challenge,
): Promise<string> {
  assertOnline();
  await ensureSession();

  const { data, error } = await supabase.rpc('join_challenge', {
    p_code: code.trim().toUpperCase(),
    p_nickname: nickname.trim(),
  });

  if (error) {
    throw new Error(
      error.message.includes('challenge not found')
        ? "That code doesn't match any challenge."
        : error.message,
    );
  }

  const challengeId = data as string;

  // Cache and remember BEFORE returning, so the challenge page has what it
  // needs the instant it mounts — network or no network.
  if (seed) await cacheChallenge({ ...seed, id: challengeId });
  await setLocalNickname(nickname);
  await rememberMembership({
    challenge_id: challengeId,
    nickname: nickname.trim(),
    is_owner: false,
    joined_at: Date.now(),
  });

  // Refresh from the server too, but never let a failure here block the join.
  if (!seed) await getChallenge(challengeId).catch(() => undefined);
  else void getChallenge(challengeId).catch(() => undefined);

  return challengeId;
}

/** Cache read, no network, no throwing — safe to render before anything loads. */
export async function getChallengeCached(id: string): Promise<Challenge | null> {
  return (await getCachedChallenge(id)) ?? null;
}

/** Reads through the cache: the dashboard must render offline. */
export async function getChallenge(id: string): Promise<Challenge | null> {
  if (isSupabaseConfigured && isOnline()) {
    await ensureSession();
    const { data, error } = await supabase.from('challenges').select('*').eq('id', id).maybeSingle();
    if (!error && data) {
      await cacheChallenge(data as Challenge);
      return data as Challenge;
    }
  }
  return (await getCachedChallenge(id)) ?? null;
}

/**
 * The server list, merged with anything this device remembers joining.
 *
 * The merge matters: if the session is briefly a different (or absent)
 * identity, the RPC returns nothing, and replacing the list with that empty
 * result is indistinguishable from "all your challenges are gone".
 */
export async function getMyChallenges(): Promise<MyChallenge[]> {
  const local = await getMyChallengesCached();
  if (!isSupabaseConfigured || !isOnline()) return local;

  await ensureSession();
  const { data, error } = await supabase.rpc('get_my_challenges');
  if (error) return local;

  const rows = (data as MyChallenge[]) ?? [];
  await Promise.all(rows.map((r) => cacheChallenge(r as unknown as Challenge)));

  const seen = new Set(rows.map((r) => r.id));
  return [...rows, ...local.filter((l) => !seen.has(l.id))];
}

export async function getMyChallengesCached(): Promise<MyChallenge[]> {
  const memberships = await getMemberships();
  const out: MyChallenge[] = [];
  for (const m of memberships) {
    const c = await getCachedChallenge(m.challenge_id);
    if (!c) continue;
    const today = todayInZone(c.timezone);
    const local = await db.workouts.get(`${c.id}:${today}`);
    out.push({
      id: c.id,
      name: c.name,
      code: c.code,
      activity_type: c.activity_type,
      tracking_mode: c.tracking_mode,
      unit: c.unit,
      daily_target: c.daily_target,
      start_date: c.start_date,
      end_date: c.end_date,
      visibility: c.visibility,
      timezone: c.timezone,
      is_owner: m.is_owner,
      today_count: local?.count ?? 0,
      participant_count: 0,
    });
  }
  return out;
}

export async function getPublicChallenges(
  filter: 'trending' | 'new' | 'most_active' | 'ending_soon' = 'trending',
): Promise<PublicChallenge[]> {
  assertOnline();
  await ensureSession();

  const { data, error } = await supabase.rpc('get_public_challenges', {
    p_filter: filter,
    p_limit: 40,
    p_offset: 0,
  });
  if (error) throw new Error(error.message);
  return (data as PublicChallenge[]) ?? [];
}

export async function getLeaderboardCached(challengeId: string): Promise<LeaderboardRow[] | null> {
  const cached = await db.leaderboards.get(challengeId);
  return cached?.rows ?? null;
}

export async function getLeaderboard(challengeId: string): Promise<LeaderboardRow[]> {
  if (!isSupabaseConfigured || !isOnline()) {
    const cached = await getLeaderboardCached(challengeId);
    if (cached) return cached;
    throw new OfflineError('Leaderboard needs a connection. Showing your local progress only.');
  }

  await ensureSession();
  const { data, error } = await supabase.rpc('get_leaderboard', { p_challenge_id: challengeId });
  if (error) {
    const cached = await getLeaderboardCached(challengeId);
    if (cached) return cached;
    throw new Error(error.message);
  }

  const rows = (data as LeaderboardRow[]) ?? [];
  await db.leaderboards.put({ challenge_id: challengeId, rows, fetched_at: Date.now() });
  return rows;
}

export async function getMyHistoryCached(challengeId: string): Promise<HistoryRow[]> {
  const challenge = await getCachedChallenge(challengeId);
  const target = challenge?.daily_target ?? 0;
  const local = await db.workouts.where('challenge_id').equals(challengeId).toArray();
  return local
    .map((w) => ({ workout_date: w.workout_date, count: w.count, met_target: w.count >= target }))
    .sort((a, b) => b.workout_date.localeCompare(a.workout_date));
}

export async function getMyHistory(challengeId: string): Promise<HistoryRow[]> {
  if (isSupabaseConfigured && isOnline()) {
    await ensureSession();
    const { data, error } = await supabase.rpc('get_my_history', { p_challenge_id: challengeId });
    if (!error) {
      const rows = (data as HistoryRow[]) ?? [];
      await db.histories.put({ challenge_id: challengeId, rows, fetched_at: Date.now() });
      return rows;
    }
  }
  return getMyHistoryCached(challengeId);
}

/**
 * Membership check that survives being offline: the local memberships table is
 * authoritative for "I already joined", and the server is consulted only to
 * discover a membership this device does not know about yet.
 */
export async function isParticipant(challengeId: string): Promise<boolean> {
  const local = await db.memberships.get(challengeId);
  if (local) return true;
  if (!isSupabaseConfigured || !isOnline()) return false;

  const uid = await ensureSession();
  if (!uid) return false;

  const { data } = await supabase
    .from('participants')
    .select('nickname')
    .eq('challenge_id', challengeId)
    .eq('user_id', uid)
    .maybeSingle();

  if (data) {
    await rememberMembership({
      challenge_id: challengeId,
      nickname: (data as { nickname: string }).nickname,
      is_owner: false,
      joined_at: Date.now(),
    });
    return true;
  }
  return false;
}

export async function getParticipants(challengeId: string): Promise<Participant[]> {
  assertOnline();
  await ensureSession();
  const { data, error } = await supabase
    .from('participants')
    .select('*')
    .eq('challenge_id', challengeId)
    .order('joined_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as Participant[]) ?? [];
}

/**
 * The one write path in the app. Always local-first: the number is in
 * IndexedDB before this resolves, and the queue delivers it whenever it can.
 */
export async function recordWorkout(args: {
  challengeId: string;
  date: string;
  count: number;
  source: WorkoutSource;
}): Promise<void> {
  await saveLocalWorkout({
    challengeId: args.challengeId,
    date: args.date,
    count: args.count,
    source: args.source,
  });
  void flushQueue('workout-saved');
}

/**
 * Rebuild this device's server-side presence after an identity reset.
 *
 * An anonymous identity that is genuinely lost cannot be recovered — but
 * everything needed to reconstruct it lives locally: the challenge codes, the
 * nickname, and every daily total. So: re-join each cached challenge under the
 * new identity, then re-queue every local workout. `join_challenge` upserts and
 * `save_workout` keeps the greater count, so running this twice is harmless.
 *
 * The old rows stay orphaned on the server (an abandoned participant with the
 * old totals); worth a cleanup job eventually, not worth blocking on now.
 */
export async function restoreAfterIdentityReset(): Promise<{
  challenges: number;
  workouts: number;
}> {
  if (!isSupabaseConfigured || !isOnline()) return { challenges: 0, workouts: 0 };

  const uid = await ensureSession();
  if (!uid) return { challenges: 0, workouts: 0 };

  const memberships = await getMemberships();
  const nickname = (await getLocalNickname()) || 'Anonymous';
  let rejoined = 0;

  for (const m of memberships) {
    const challenge = await getCachedChallenge(m.challenge_id);
    if (!challenge?.code) continue;
    const { error } = await supabase.rpc('join_challenge', {
      p_code: challenge.code,
      p_nickname: m.nickname || nickname,
    });
    if (!error) rejoined += 1;
  }

  const workouts = await allLocalWorkouts();
  for (const w of workouts) {
    await saveLocalWorkout({
      challengeId: w.challenge_id,
      date: w.workout_date,
      count: w.count,
      source: w.source,
    });
  }

  void flushQueue('identity-restore');
  return { challenges: rejoined, workouts: workouts.length };
}

// ---------------------------------------------------------------------------
// Portable identity
// ---------------------------------------------------------------------------

export interface TransferCode {
  code: string;
  expires_at: string;
}

/**
 * Issue a code that moves this participant's history to another install.
 *
 * Needed because an iOS home-screen app gets a storage container completely
 * separate from Safari's: the anonymous identity that has been logging
 * workouts all week does not come across, and there is no API that would let
 * it. So the identity is made portable instead — this also happens to solve
 * "I got a new phone", which was otherwise unrecoverable for an account with
 * no password.
 */
export async function createTransferCode(): Promise<TransferCode> {
  assertOnline();
  const uid = await ensureSession();
  if (!uid) throw new Error('Not signed in yet — try again in a moment.');

  const { data, error } = await supabase.rpc('create_transfer_code');
  if (error) throw new Error(error.message);

  const row = (data as TransferCode[])?.[0];
  if (!row) throw new Error('Could not create a transfer code.');
  return row;
}

export interface TransferResult {
  challenges_moved: number;
  workouts_moved: number;
  nickname: string;
}

/** Redeem a code, then pull everything it moved down onto this device. */
export async function claimTransfer(code: string): Promise<TransferResult> {
  assertOnline();
  const uid = await ensureSession();
  if (!uid) throw new Error('Not signed in yet — try again in a moment.');

  const { data, error } = await supabase.rpc('claim_transfer', {
    p_code: code.trim().toUpperCase(),
  });

  if (error) {
    throw new Error(
      error.message.includes('not valid or has expired')
        ? 'That code is not valid, has already been used, or has expired. Codes last 30 minutes.'
        : error.message,
    );
  }

  const result = (data as TransferResult[])?.[0] ?? {
    challenges_moved: 0,
    workouts_moved: 0,
    nickname: '',
  };

  if (result.nickname) await setLocalNickname(result.nickname);
  await hydrateFromServer();
  return result;
}

/**
 * Rebuild the local store from the server: memberships, cached challenges and
 * every daily total. Rows land marked `synced` so the sync queue has nothing
 * to push back — this is a download, not a set of pending writes.
 */
export async function hydrateFromServer(): Promise<void> {
  if (!isSupabaseConfigured || !isOnline()) return;
  await ensureSession();

  const rows = await getMyChallenges();
  const fallbackNickname = (await getLocalNickname()) || 'Anonymous';

  for (const c of rows) {
    await rememberMembership({
      challenge_id: c.id,
      nickname: fallbackNickname,
      is_owner: c.is_owner,
      joined_at: Date.now(),
    });

    const history = await getMyHistory(c.id);
    for (const h of history) {
      await db.workouts.put({
        key: workoutKey(c.id, h.workout_date),
        challenge_id: c.id,
        workout_date: h.workout_date,
        count: h.count,
        source: 'cv',
        updated_at: Date.now(),
        synced: true,
      });
    }
  }
}
