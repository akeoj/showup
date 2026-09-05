import { create } from 'zustand';
import { getLocalNickname, setLocalNickname } from '@/lib/db';
import { currentUserId, ensureSession } from '@/lib/supabase';

interface AppState {
  nickname: string;
  userId: string | null;
  ready: boolean;
  /** Reps carried from the workout screen to the results screen. */
  lastResult: { challengeId: string; count: number; total: number; target: number } | null;
  init: () => Promise<void>;
  setNickname: (n: string) => Promise<void>;
  setLastResult: (r: AppState['lastResult']) => void;
}

export const useAppStore = create<AppState>((set) => ({
  nickname: '',
  userId: null,
  ready: false,
  lastResult: null,

  init: async () => {
    const [nickname, cachedId] = await Promise.all([getLocalNickname(), currentUserId()]);
    set({ nickname, userId: cachedId, ready: true });
    // Non-blocking: the app is usable before auth resolves, which matters on 3G.
    void ensureSession().then((id) => id && set({ userId: id }));
  },

  setNickname: async (n: string) => {
    await setLocalNickname(n);
    set({ nickname: n.trim() });
  },

  setLastResult: (r) => set({ lastResult: r }),
}));
