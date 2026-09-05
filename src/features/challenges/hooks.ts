import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getChallenge, getLeaderboard, getMyHistory } from './api';
import { db, workoutKey } from '@/lib/db';
import { isOnline, onNetworkChange } from '@/lib/network';
import { getSyncState, onSyncChange } from '@/lib/sync';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { todayInZone } from '@/lib/dates';
import type { Challenge, HistoryRow, LeaderboardRow } from '@/lib/types';

export function useOnline(): boolean {
  const [online, setOnline] = useState(isOnline());
  useEffect(() => onNetworkChange(setOnline), []);
  return online;
}

export function useSyncStatus() {
  const [s, setS] = useState(getSyncState());
  useEffect(() => onSyncChange(setS), []);
  return s;
}

export function useChallenge(id: string | undefined) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const c = await getChallenge(id);
      setChallenge(c);
      setError(c ? null : 'Challenge not found on this device.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { challenge, loading, error, reload };
}

/** Today's local total for a challenge, kept in step with the local store. */
export function useTodayCount(challenge: Challenge | null) {
  const [count, setCount] = useState(0);
  const [synced, setSynced] = useState(true);

  const today = useMemo(
    () => (challenge ? todayInZone(challenge.timezone) : ''),
    [challenge],
  );

  const reload = useCallback(async () => {
    if (!challenge) return;
    const row = await db.workouts.get(workoutKey(challenge.id, today));
    setCount(row?.count ?? 0);
    setSynced(row?.synced ?? true);
  }, [challenge, today]);

  useEffect(() => {
    void reload();
    const unsub = onSyncChange(() => void reload());
    return unsub;
  }, [reload]);

  return { count, today, synced, reload };
}

export function useHistory(challengeId: string | undefined) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!challengeId) return;
    setLoading(true);
    try {
      setRows(await getMyHistory(challengeId));
    } finally {
      setLoading(false);
    }
  }, [challengeId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { rows, loading, reload };
}

/**
 * Leaderboard with realtime refresh.
 *
 * The subscription is scoped to this one challenge's workout rows — never the
 * whole table — and a change only triggers a re-query, debounced, rather than
 * trying to patch rankings client-side. Aggregation stays server-side.
 */
export function useLeaderboard(challenge: Challenge | null) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<number | undefined>(undefined);

  const challengeId = challenge?.id;

  const reload = useCallback(async () => {
    if (!challengeId) return;
    try {
      setRows(await getLeaderboard(challengeId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [challengeId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!challengeId || !isSupabaseConfigured) return;

    const channel = supabase
      .channel(`challenge:${challengeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workouts',
          filter: `challenge_id=eq.${challengeId}`,
        },
        () => {
          window.clearTimeout(debounce.current);
          debounce.current = window.setTimeout(() => void reload(), 700);
        },
      )
      .subscribe();

    return () => {
      window.clearTimeout(debounce.current);
      void supabase.removeChannel(channel);
    };
  }, [challengeId, reload]);

  return { rows, loading, error, reload };
}
