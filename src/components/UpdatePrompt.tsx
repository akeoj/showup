import { useCallback, useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from './Button';
import { hardReset, isStale } from '@/lib/version';

/**
 * Registers the service worker and asks before applying an update.
 *
 * Two independent ways of noticing a new version, because on iOS the service
 * worker alone is not trustworthy: a home-screen app has its own registration
 * and iOS often will not re-check it in an app that is only ever resumed. So
 * the app also compares its build id against an uncacheable version.json, and
 * offers the update either way.
 *
 * The prompt is never automatic — `registerType: 'autoUpdate'` reloads the
 * page the instant a new worker activates, which is how someone loses a set of
 * push-ups to a deploy.
 */
export function UpdatePrompt() {
  const [versionStale, setVersionStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      registrationRef.current = registration;

      let lastCheck = Date.now();
      const check = () => {
        lastCheck = Date.now();
        void registration.update().catch(() => undefined);
      };

      setInterval(check, 60 * 60 * 1000);

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

  // The version check, which does not depend on the worker noticing anything.
  const checkVersion = useCallback(() => {
    void isStale().then((stale) => {
      if (stale) setVersionStale(true);
    });
  }, []);

  useEffect(() => {
    checkVersion();
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkVersion();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(checkVersion, 30 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [checkVersion]);

  const show = needRefresh || versionStale;
  if (!show) return null;

  const dismiss = () => {
    setNeedRefresh(false);
    setVersionStale(false);
  };

  const apply = async () => {
    setBusy(true);

    // Give the normal path a moment: ask the worker to update, then let it
    // take over. If the page has not reloaded shortly after, the worker is
    // stuck — which on iOS is common enough to plan for — so clear it out.
    const fallback = window.setTimeout(() => void hardReset(), 6000);

    try {
      await registrationRef.current?.update().catch(() => undefined);
      await updateServiceWorker(true);
    } catch {
      window.clearTimeout(fallback);
      await hardReset();
    }
  };

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-2xl border border-line bg-surface p-4 shadow-2xl">
      <p className="text-sm font-medium">A new version of Showup is ready.</p>
      <p className="mt-0.5 text-xs text-muted">
        Your progress is saved — updating just reloads the app.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={dismiss} disabled={busy}>
          Later
        </Button>
        <Button onClick={apply} loading={busy}>
          Update
        </Button>
      </div>
    </div>
  );
}
