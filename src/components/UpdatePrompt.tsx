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
      if (!registration) return;

      let lastCheck = Date.now();
      const check = () => {
        lastCheck = Date.now();
        void registration.update().catch(() => undefined);
      };

      // Hourly, for a session left open for days.
      setInterval(check, 60 * 60 * 1000);

      // And on resume. An installed app that sits in the background for a day
      // and is then reopened would otherwise wait a full hour before noticing
      // a deploy — which on iOS, where the app is resumed far more often than
      // it is launched, is most of the time.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Date.now() - lastCheck > 15 * 60 * 1000) {
          check();
        }
      });
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
