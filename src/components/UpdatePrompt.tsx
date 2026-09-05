import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from './Button';

/**
 * Registers the service worker and asks before applying an update.
 *
 * The alternative (`registerType: 'autoUpdate'`) reloads the page the instant a
 * new worker activates — mid-set, mid-form, mid-anything. A deploy should never
 * be able to interrupt someone's workout, so the reload waits for a tap.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Check hourly rather than only on load: an installed PWA can stay open
      // for days without ever navigating.
      if (registration) {
        setInterval(() => void registration.update().catch(() => undefined), 60 * 60 * 1000);
      }
    },
    onRegisterError(err) {
      console.warn('[showup] service worker registration failed', err);
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-2xl border border-line bg-surface p-4 shadow-2xl">
      <p className="text-sm font-medium">A new version of Showup is ready.</p>
      <p className="mt-0.5 text-xs text-muted">
        Your progress is saved — updating just reloads the app.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => setNeedRefresh(false)}>
          Later
        </Button>
        <Button onClick={() => void updateServiceWorker(true)}>Update</Button>
      </div>
    </div>
  );
}
