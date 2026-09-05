type Listener = (online: boolean) => void;

const listeners = new Set<Listener>();
let online = typeof navigator === 'undefined' ? true : navigator.onLine;

function emit(next: boolean) {
  if (next === online) return;
  online = next;
  listeners.forEach((fn) => fn(next));
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => emit(true));
  window.addEventListener('offline', () => emit(false));
}

export const isOnline = () => online;

export function onNetworkChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * `navigator.onLine` is optimistic — on a captive portal or a stalled 3G
 * connection it reports true while nothing actually goes through. Treat a
 * failed request as offline rather than trusting the flag.
 */
export function markOffline() {
  emit(false);
}
