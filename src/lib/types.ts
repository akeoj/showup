export type Visibility = 'private' | 'public';
export type TrackingMode = 'cv' | 'manual';
export type WorkoutSource = 'cv' | 'manual';

export interface Challenge {
  id: string;
  name: string;
  code: string;
  activity_type: string;
  tracking_mode: TrackingMode;
  unit: string;
  daily_target: number;
  start_date: string; // YYYY-MM-DD
  end_date: string;
  visibility: Visibility;
  timezone: string;
  description?: string | null;
  creator_id?: string;
  created_at?: string;
}

export interface ChallengePreview {
  id: string;
  name: string;
  code: string;
  activity_type: string;
  tracking_mode: TrackingMode;
  unit: string;
  daily_target: number;
  start_date: string;
  end_date: string;
  visibility: Visibility;
  timezone: string;
  description: string | null;
  participant_count: number;
  creator_nickname: string | null;
  already_joined: boolean;
}

export interface PublicChallenge {
  id: string;
  name: string;
  code: string;
  activity_type: string;
  tracking_mode: TrackingMode;
  unit: string;
  daily_target: number;
  start_date: string;
  end_date: string;
  description: string | null;
  participant_count: number;
  active_today: number;
  creator_nickname: string | null;
}

export interface MyChallenge {
  id: string;
  name: string;
  code: string;
  activity_type: string;
  tracking_mode: TrackingMode;
  unit: string;
  daily_target: number;
  start_date: string;
  end_date: string;
  visibility: Visibility;
  timezone: string;
  is_owner: boolean;
  today_count: number;
  participant_count: number;
}

export interface LeaderboardRow {
  user_id: string;
  nickname: string;
  today_count: number;
  total_count: number;
  completed_days: number;
  current_streak: number;
  longest_streak: number;
}

export interface HistoryRow {
  workout_date: string;
  count: number;
  met_target: boolean;
}

export interface Participant {
  id: string;
  challenge_id: string;
  user_id: string;
  nickname: string;
  joined_at: string;
}

/** A day's total for one challenge, as held locally. */
export interface LocalWorkout {
  /** `${challenge_id}:${workout_date}` — one aggregate row per challenge-day. */
  key: string;
  challenge_id: string;
  workout_date: string;
  count: number;
  source: WorkoutSource;
  updated_at: number;
  synced: boolean;
}

export type SyncStatus = 'pending' | 'failed';

export interface SyncQueueItem {
  id?: number;
  entity: 'workout';
  /** Dedupe key — a newer write for the same day replaces the queued one. */
  ref: string;
  payload: {
    challenge_id: string;
    workout_date: string;
    count: number;
    source: WorkoutSource;
  };
  created_at: number;
  retry_count: number;
  last_error?: string;
  next_attempt_at: number;
  status: SyncStatus;
}

export interface LocalUser {
  id: 'me';
  nickname: string;
  /** Last auth user id this device held — used to detect an identity reset. */
  user_id?: string;
  updated_at: number;
}
