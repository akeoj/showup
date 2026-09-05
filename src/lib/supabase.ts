import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import {
  clearSessionMirror,
  getKnownUserId,
  getSessionMirror,
  saveSessionMirror,
  setKnownUserId,
} from './db';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey && !url.includes('YOUR-PROJECT'));

export const supabase: SupabaseClient = createClient(
  url ?? 'http://localhost',
  anonKey ?? 'public-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'showup.auth',
    },
    realtime: { params: { eventsPerSecond: 4 } },
  },
);

/**
 * Set when this device had an identity, lost it, and had to start a new one.
 * The participant's server-side history belongs to the old id and cannot be
 * recovered — but their local workouts can be replayed onto the new identity,
 * which is what `restoreAfterIdentityReset()` in features/challenges/api does.
 */
let identityWasReset = false;
export const wasIdentityReset = () => identityWasReset;

async function mirror(session: Session | null): Promise<void> {
  if (!session?.user) return;
  await Promise.all([
    saveSessionMirror({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      user_id: session.user.id,
    }),
    setKnownUserId(session.user.id),
  ]);
}

if (isSupabaseConfigured) {
  supabase.auth.onAuthStateChange((event, session) => {
    if (session) void mirror(session);
    // Deliberately NOT clearing the mirror on SIGNED_OUT: a failed token
    // refresh while offline emits that event, and throwing away the refresh
    // token there is exactly how a participant loses their identity for good.
    if (event === 'USER_UPDATED' && !session) void clearSessionMirror();
  });
}

let ensuring: Promise<string | null> | null = null;

/**
 * Returns the current user id, in this order of preference:
 *
 *   1. a live session
 *   2. the session mirrored into IndexedDB (localStorage was cleared)
 *   3. a brand-new anonymous user — but ONLY if this device never had one
 *   4. a new anonymous user + `identityWasReset`, if the old one is unrecoverable
 *
 * Step 2 is the important one. Steps 3 and 4 look identical to the auth layer
 * and completely different to the participant, which is why they are separated.
 *
 * Requires "Anonymous sign-ins" enabled in Supabase → Authentication → Providers.
 */
export async function ensureSession(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  if (ensuring) return ensuring;

  ensuring = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        await mirror(data.session);
        return data.session.user.id;
      }

      // 2. Rebuild the session from our own copy of the refresh token.
      const saved = await getSessionMirror();
      if (saved?.refresh_token) {
        if (!navigator.onLine) {
          // Offline with a known identity: the app keeps working from local
          // data, and we try again the moment the connection returns.
          return null;
        }
        const { data: restored, error } = await supabase.auth.setSession({
          access_token: saved.access_token,
          refresh_token: saved.refresh_token,
        });
        if (!error && restored.session?.user) {
          await mirror(restored.session);
          return restored.session.user.id;
        }
        console.warn('[showup] could not restore session:', error?.message);
      }

      if (!navigator.onLine) return null;

      // 3 / 4. New identity. Whether that is a first run or a loss matters.
      const hadOne = (await getKnownUserId()) ?? saved?.user_id ?? null;

      const { data: signed, error } = await supabase.auth.signInAnonymously();
      if (error) {
        console.warn('[showup] anonymous sign-in failed:', error.message);
        return null;
      }

      if (signed.session) await mirror(signed.session);
      if (hadOne && signed.user && hadOne !== signed.user.id) {
        identityWasReset = true;
        console.warn('[showup] identity reset: %s → %s', hadOne, signed.user.id);
      }
      return signed.user?.id ?? null;
    } catch (err) {
      console.warn('[showup] session bootstrap failed', err);
      return null;
    } finally {
      setTimeout(() => {
        ensuring = null;
      }, 0);
    }
  })();

  return ensuring;
}

export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user) return data.session.user.id;
  // Offline or pre-restore: the last id we knew is still the right one to show.
  return getKnownUserId();
}
