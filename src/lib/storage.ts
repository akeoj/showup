/**
 * Ask the browser to stop evicting our data.
 *
 * This is the difference between "offline-first" and "offline-first until the
 * browser feels like clearing house". Without a persistence grant, Safari
 * evicts IndexedDB and localStorage for a site after ~7 days without a visit,
 * and Chrome evicts under storage pressure — taking the participant's workouts
 * and, worse, their anonymous identity with it.
 *
 * Installed PWAs are granted this automatically in Chrome; Safari grants it on
 * add-to-home-screen. Calling it is free and idempotent.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usedMb: number; quotaMb: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usedMb: usage / 1e6, quotaMb: quota / 1e6 };
  } catch {
    return null;
  }
}

/** True when the app is running from the home screen rather than a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari's non-standard flag.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
