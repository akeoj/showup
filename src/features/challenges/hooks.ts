import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getChallenge,
  getChallengeCached,
  getLeaderboard,
  getLeaderboardCached,
  getMyHistory,
  getMyHistoryCached,
} from './api';
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

/**
 * Cache first, then revalidate.
 *
 * Reopening the app must never mean staring at "Loading…" while a request
 * crosses a 3G network — the answer is already on the device. The network
 * result quietly replaces it when (and if) it arrives.
 */
export function useChallenge(id: string | undefined) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) return;
    try {
      const fresh = await getChallenge(id);
      if (fresh) {
        setChallenge(fresh);
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    if (!id) return;

    void (async () => {
      const cached = await getChallengeCached(id);
      if (!cancelled && cached) setChallenge(cached);
      if (!cancelled) setLoading(false);

      await reload();
      if (!cancelled) {
        setLoading(false);
        setChallenge((current) => {
          if (!current && !cached) setError('Challenge not found on this device.');
          return current;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, reload]);

  return { challenge, loading, error, reload };
}

/** Today's local total for a challenge, kept in step with the local store. */
export function useTodayCount(challenge: Challenge | null) {
  const [count, setCount] = useState(0);
  const [synced, setSynced] = useState(true);

  const today = useMemo(() => (challenge ? todayInZone(challenge.timezone) : ''), [challenge]);

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
    setRows(await getMyHistory(challengeId));
    setLoading(false);
  }, [challengeId]);

  useEffect(() => {
    let cancelled = false;
    if (!challengeId) return;

    void (async () => {
      const cached = await getMyHistoryCached(challengeId);
      if (!cancelled && cached.length) {
        setRows(cached);
        setLoading(false);
      }
      await reload();
    })();

    return () => {
      cancelled = true;
    };
  }, [challengeId, reload]);

  return { rows, loading, reload };
}

/**
 * Leaderboard with realtime refresh.
 *
 * Seeded from the last snapshot so the board is on screen immediately, then
 * refreshed. The subscription is scoped to this one challenge's workout rows,
 * and a change only triggers a debounced re-query — aggregation stays
 * server-side rather than being patched client-side.
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
      // A cached board is already on screen; only surface the error if not.
      setRows((current) => {
        if (current.length === 0) setError(e instanceof Error ? e.message : String(e));
        return current;
      });
    } finally {
      setLoading(false);
    }
  }, [challengeId]);

  useEffect(() => {
    let cancelled = false;
    if (!challengeId) return;

    void (async () => {
      const cached = await getLeaderboardCached(challengeId);
      if (!cancelled && cached?.length) {
        setRows(cached);
        setLoading(false);
      }
      await reload();
    })();

    return () => {
      cancelled = true;
    };
  }, [challengeId, reload]);

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
