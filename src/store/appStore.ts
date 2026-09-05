import { create } from 'zustand';
import { getLocalNickname, setLocalNickname } from '@/lib/db';
import { currentUserId, ensureSession, wasIdentityReset } from '@/lib/supabase';
import { restoreAfterIdentityReset } from '@/features/challenges/api';

interface AppState {
  nickname: string;
  userId: string | null;
  ready: boolean;
  /** True while this device is rebuilding its server presence after a reset. */
  restoring: boolean;
  /** Set once a reset has been detected and repaired, for the one-time notice. */
  restored: { challenges: number; workouts: number } | null;
  /** Reps carried from the workout screen to the results screen. */
  lastResult: { challengeId: string; count: number; total: number; target: number } | null;
  init: () => Promise<void>;
  setNickname: (n: string) => Promise<void>;
  setLastResult: (r: AppState['lastResult']) => void;
  dismissRestored: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  nickname: '',
  userId: null,
  ready: false,
  restoring: false,
  restored: null,
  lastResult: null,

  init: async () => {
    const [nickname, cachedId] = await Promise.all([getLocalNickname(), currentUserId()]);
    // The app is usable before auth resolves, which matters a lot on 3G and
    // matters completely when there is no connection at all.
    set({ nickname, userId: cachedId, ready: true });

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

  setLastResult: (r) => set({ lastResult: r }),

  dismissRestored: () => set({ restored: null }),
}));
