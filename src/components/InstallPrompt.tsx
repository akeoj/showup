import { useCallback, useEffect, useState } from 'react';
import { Button } from './Button';
import { TransferCode } from './TransferCode';
import { isSupabaseConfigured } from '@/lib/supabase';
import {
  installCapability,
  onInstallChange,
  promptInstall,
  shouldOfferInstall,
  type InstallCapability,
} from '@/lib/install';
import { snoozeInstallPrompt } from '@/lib/install';

interface Props {
  /** Shown above the ask, e.g. "You're in. Add Showup to your home screen". */
  headline?: string;
  /** 'card' sits in the page flow; 'inline' is a slimmer version. */
  variant?: 'card' | 'inline';
}

export function InstallPrompt({ headline, variant = 'card' }: Props) {
  const [capability, setCapability] = useState<InstallCapability>('unsupported');
  const [offer, setOffer] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setCapability(installCapability());
    void shouldOfferInstall().then(setOffer);
  }, []);

  useEffect(() => {
    refresh();
    return onInstallChange(refresh);
  }, [refresh]);

  if (!offer || capability === 'installed' || capability === 'unsupported') return null;

  const dismiss = () => {
    setOffer(false);
    void snoozeInstallPrompt();
  };

  const install = async () => {
    setBusy(true);
    const outcome = await promptInstall();
    setBusy(false);
    if (outcome === 'accepted' || outcome === 'dismissed') {
      setOffer(false);
      if (outcome === 'dismissed') void snoozeInstallPrompt();
    }
  };

  const wrapper =
    variant === 'card'
      ? 'card border-flame/40 bg-flame/10'
      : 'rounded-xl border border-flame/30 bg-flame/10 p-3';

  // ---- In-app browser: install is impossible here, and so is a reliable camera.
  if (capability === 'in-app-browser') {
    return (
      <div className={wrapper}>
        <p className="text-sm font-medium">Open this in your browser</p>
        <p className="mt-1 text-sm text-muted">
          You're inside WhatsApp's built-in browser. The camera and "add to home screen" don't work
          here. Tap the ⋮ (or ⋯) menu at the corner of this screen and choose{' '}
          <strong className="text-text">Open in browser</strong>.
        </p>
        <button onClick={dismiss} className="mt-2 text-xs text-muted underline underline-offset-4">
          Dismiss
        </button>
      </div>
    );
  }

  // ---- iOS: no install API exists, only instructions.
  if (capability === 'ios-manual') {
    return (
      <>
        <div className={wrapper}>
          <p className="text-sm font-medium">{headline ?? 'Add Showup to your home screen'}</p>
          <p className="mt-1 text-sm text-muted">
            It opens like an app, works offline, and keeps your progress.
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" onClick={dismiss} className="flex-1 !py-2.5 text-sm">
              Not now
            </Button>
            <Button onClick={() => setShowIosSteps(true)} className="flex-1 !py-2.5 text-sm">
              Show me how
            </Button>
          </div>
        </div>

        {showIosSteps && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center">
            <div className="w-full max-w-md rounded-t-3xl border border-line bg-surface p-5 pb-8 sm:rounded-3xl">
              <h2 className="text-lg font-semibold">Add to your home screen</h2>
              <ol className="mt-4 space-y-3 text-sm">
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-flame text-xs font-bold text-ink">
                    1
                  </span>
                  <span>
                    Tap the <strong>Share</strong> button — the square with an arrow pointing up, at
                    the bottom of Safari.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-flame text-xs font-bold text-ink">
                    2
                  </span>
                  <span>
                    Scroll down and tap <strong>Add to Home Screen</strong>.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-flame text-xs font-bold text-ink">
                    3
                  </span>
                  <span>
                    Tap <strong>Add</strong>. Showup appears with your other apps.
                  </span>
                </li>
              </ol>
              <p className="mt-4 text-xs text-muted">
                This only works in Safari. If you opened the link from WhatsApp, tap the ⋯ menu
                first and choose Open in Safari.
              </p>

              {/*
                On iOS the installed app gets a storage container completely
                separate from Safari's, so anything logged in the browser does
                NOT come across. The code has to be taken before installing —
                afterwards, this page can no longer see the old identity.
              */}
              {isSupabaseConfigured && (
                <div className="mt-4 rounded-xl border border-flame/30 bg-flame/10 p-3">
                  <p className="text-sm font-medium">Take your progress with you</p>
                  <p className="mt-1 text-xs text-muted">
                    The home-screen app starts with its own storage, so anything you've logged here
                    won't appear in it. Grab this code first and enter it once in the app.
                  </p>
                  <div className="mt-3">
                    <TransferCode />
                  </div>
                </div>
              )}
              <Button
                full
                className="mt-5"
                onClick={() => {
                  setShowIosSteps(false);
                  dismiss();
                }}
              >
                Got it
              </Button>
            </div>
          </div>
        )}
      </>
    );
  }

  // ---- Android/Chrome: the real one-tap install.
  return (
    <div className={wrapper}>
      <p className="text-sm font-medium">{headline ?? 'Add Showup to your home screen'}</p>
      <p className="mt-1 text-sm text-muted">
        Opens like an app, works offline, and keeps your streak on this phone.
      </p>
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" onClick={dismiss} className="flex-1 !py-2.5 text-sm">
          Not now
        </Button>
        <Button onClick={install} loading={busy} className="flex-1 !py-2.5 text-sm">
          Install
        </Button>
      </div>
    </div>
  );
}
