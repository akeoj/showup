/**
 * Knowing we are stale without asking the service worker.
 *
 * On iOS a home-screen app is a separate installation from Safari — its own
 * service worker registration, its own caches — and iOS is reluctant to
 * re-check that worker in an app that is resumed rather than cold launched.
 * The result: Safari picks up a deploy immediately while the installed app
 * sits on an old build indefinitely, which is exactly the behaviour reported.
 *
 * So the app compares its own build id against a tiny file on the origin that
 * nothing is allowed to cache. If they differ, we are stale — whatever the
 * service worker believes.
 */

export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

export interface VersionInfo {
  version: string;
  builtAt?: string;
}

/**
 * Returns the deployed build id, or null if it cannot be determined (offline,
 * blocked, or a dev server with no version.json — none of which should ever
 * produce an update prompt).
 */
export async function fetchDeployedVersion(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: 'no-store',
      // Belt and braces: the runtime caching rule marks this NetworkOnly, and
      // the origin sends no-store, and we bust the URL anyway.
      headers: { 'cache-control': 'no-cache' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as VersionInfo;
    return typeof data?.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}

export async function isStale(): Promise<boolean> {
  if (BUILD_ID === 'dev') return false;
  const deployed = await fetchDeployedVersion();
  if (!deployed) return false;
  return deployed !== BUILD_ID;
}

/**
 * Last resort for a service worker that will not hand over.
 *
 * Unregisters every worker and drops the app's own caches, then reloads
 * against the network. The MediaPipe runtime and model caches are kept
 * deliberately — they are ~15MB, they are not versioned with the app, and
 * making someone re-download them over Nigerian mobile data to fix a UI
 * update would be its own kind of broken.
 */
export async function hardReset(): Promise<void> {
  const KEEP = ['mediapipe-runtime', 'pose-model'];
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k).catch(() => false)),
      );
    }
  } catch {
    /* proceed to reload regardless — a reload is the point */
  }
  // Bypass any bfcache/snapshot the OS is holding onto.
  window.location.replace(`${window.location.pathname}?u=${Date.now()}`);
}
