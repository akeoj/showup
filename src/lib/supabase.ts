import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey && !url.includes('YOUR-PROJECT'));

/**
 * A single client for the whole app. The session is persisted, so an
 * anonymous participant keeps their identity across reloads and — crucially —
 * across being offline, since the JWT is read from localStorage rather than
 * fetched.
 */
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

let ensuring: Promise<string | null> | null = null;

/**
 * Returns the current user id, signing in anonymously the first time.
 *
 * Requires "Anonymous sign-ins" to be enabled in Supabase → Authentication →
 * Providers. Offline, this resolves from the cached session or returns null,
 * and the app keeps working locally.
 */
export async function ensureSession(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  if (ensuring) return ensuring;

  ensuring = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) return data.session.user.id;
      if (!navigator.onLine) return null;

      const { data: signed, error } = await supabase.auth.signInAnonymously();
      if (error) {
        console.warn('[showup] anonymous sign-in failed:', error.message);
        return null;
      }
      return signed.user?.id ?? null;
    } catch (err) {
      console.warn('[showup] session bootstrap failed', err);
      return null;
    } finally {
      // Allow a retry on the next call rather than caching a failure forever.
      setTimeout(() => {
        ensuring = null;
      }, 0);
    }
  })();

  return ensuring;
}

export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}
