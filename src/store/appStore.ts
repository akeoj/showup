import { create } from 'zustand';
import { getLocalNickname, setLocalNickname } from '@/lib/db';
import { currentUserId, ensureSession, wasIdentityReset } from '@/lib/supabase';
import { recordWorkout, restoreAfterIdentityReset } from '@/features/challenges/api';
import {
  clearActiveWorkout,
  getActiveWorkout,
  getLastResult,
  saveLastResult,
} from '@/lib/appMemory';

export interface WorkoutResult {
  challengeId: string;
  count: number;
  total: number;
  target: number;
}

interface AppState {
  nickname: string;
  userId: string | null;
  ready: boolean;
  /** True while this device is rebuilding its server presence after a reset. */
  restoring: boolean;
  /** Set once a reset has been detected and repaired, for the one-time notice. */
  restored: { challenges: number; workouts: number } | null;
  /** Reps rescued from a workout the OS killed before it could be saved. */
  recoveredReps: number | null;
  /** Carried from the workout screen to the results screen — and across a kill. */
  lastResult: WorkoutResult | null;
  init: () => Promise<void>;
  setNickname: (n: string) => Promise<void>;
  setLastResult: (r: WorkoutResult | null) => void;
  dismissRestored: () => void;
  dismissRecovered: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  nickname: '',
  userId: null,
  ready: false,
  restoring: false,
  restored: null,
  recoveredReps: null,
  lastResult: null,

  init: async () => {
    const [nickname, cachedId, storedResult] = await Promise.all([
      getLocalNickname(),
      currentUserId(),
      getLastResult(),
    ]);

    // The app is usable before auth resolves, which matters a lot on 3G and
    // matters completely when there is no connection at all.
    set({
      nickname,
      userId: cachedId,
      ready: true,
      lastResult: storedResult
        ? {
            challengeId: storedResult.challengeId,
            count: storedResult.count,
            total: storedResult.total,
            target: storedResult.target,
          }
        : null,
    });

    // A workout the OS interrupted. The reps were written to IndexedDB as they
    // were counted, so they are banked now rather than mourned.
    void (async () => {
      const active = await getActiveWorkout();
      if (!active || active.reps <= 0) {
        if (active) await clearActiveWorkout();
        return;
      }
      await recordWorkout({
        challengeId: active.challengeId,
        date: active.date,
        count: active.base + active.reps,
        source: 'cv',
      });
      await clearActiveWorkout();
      set({ recoveredReps: active.reps });
    })();

    void ensureSession().then(async (id) => {
      if (id) set({ userId: id });
      if (!wasIdentityReset()) return;

      // This device lost its anonymous identity. Everything needed to rebuild
      // it is local, so rebuild it rather than showing an empty app.
      set({ restoring: true });
      try {
        const result = await restoreAfterIdentityReset();
        set({ restored: result });
      } finally {
        set({ restoring: false });
      }
    });
  },

  setNickname: async (n: string) => {
    await setLocalNickname(n);
    set({ nickname: n.trim() });
  },

  setLastResult: (r) => {
    set({ lastResult: r });
    if (r) void saveLastResult(r);
  },

  dismissRestored: () => set({ restored: null }),
  dismissRecovered: () => set({ recoveredReps: null }),
}));
