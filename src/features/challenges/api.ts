import {
  cacheChallenge,
  db,
  getCachedChallenge,
  rememberMembership,
  saveLocalWorkout,
  setLocalNickname,
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

export async function joinChallenge(code: string, nickname: string): Promise<string> {
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
  await setLocalNickname(nickname);
  await rememberMembership({
    challenge_id: challengeId,
    nickname: nickname.trim(),
    is_owner: false,
    joined_at: Date.now(),
  });
  // Pull the full row now so the dashboard works if the network drops next.
  await getChallenge(challengeId).catch(() => undefined);
  return challengeId;
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

export async function getMyChallenges(): Promise<MyChallenge[]> {
  if (!isSupabaseConfigured || !isOnline()) return cachedMyChallenges();
  await ensureSession();

  const { data, error } = await supabase.rpc('get_my_challenges');
  if (error) return cachedMyChallenges();

  const rows = (data as MyChallenge[]) ?? [];
  await Promise.all(rows.map((r) => cacheChallenge(r as unknown as Challenge)));
  return rows;
}

async function cachedMyChallenges(): Promise<MyChallenge[]> {
  const memberships = await db.memberships.toArray();
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

export async function getLeaderboard(challengeId: string): Promise<LeaderboardRow[]> {
  if (!isSupabaseConfigured || !isOnline()) {
    const cached = await db.leaderboards.get(challengeId);
    if (cached) return cached.rows;
    throw new OfflineError('Leaderboard needs a connection. Showing your local progress only.');
  }

  await ensureSession();
  const { data, error } = await supabase.rpc('get_leaderboard', { p_challenge_id: challengeId });
  if (error) {
    const cached = await db.leaderboards.get(challengeId);
    if (cached) return cached.rows;
    throw new Error(error.message);
  }

  const rows = (data as LeaderboardRow[]) ?? [];
  await db.leaderboards.put({ challenge_id: challengeId, rows, fetched_at: Date.now() });
  return rows;
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

  // Offline: rebuild history from the local store so the calendar still fills in.
  const challenge = await getCachedChallenge(challengeId);
  const local = await db.workouts.where('challenge_id').equals(challengeId).toArray();
  const target = challenge?.daily_target ?? 0;
  return local
    .map((w) => ({ workout_date: w.workout_date, count: w.count, met_target: w.count >= target }))
    .sort((a, b) => b.workout_date.localeCompare(a.workout_date));
}

/**
 * Membership check that survives being offline: the local memberships table is
 * authoritative for "I already joined", and the server is consulted only to
 * discover a membership this device does not know about yet (e.g. same
 * anonymous identity, different entry point).
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
