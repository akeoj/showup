import { getKV, setKV } from './db';
import { isStandalone } from './storage';

/**
 * Add-to-home-screen, which is three completely different problems wearing one
 * name:
 *
 *  - Android/Chrome fires `beforeinstallprompt` and lets us trigger the real
 *    system installer. This is the only case where a one-tap install exists.
 *  - iOS Safari has no such API at all. The only route is Share → Add to Home
 *    Screen, so all we can do is show the steps.
 *  - An in-app browser (WhatsApp, Instagram, Facebook) can do NEITHER, and this
 *    matters more than the other two combined for a product whose invites are
 *    shared on WhatsApp: tapping the link opens a WebView where install is
 *    impossible and camera access is unreliable. The only fix is getting the
 *    user into a real browser, so we detect it and say so.
 */

export type InstallCapability =
  | 'installed' // already running from the home screen
  | 'promptable' // Android/Chrome, native installer available
  | 'ios-manual' // iOS Safari, needs the Share-sheet instructions
  | 'in-app-browser' // WhatsApp/IG/FB WebView — must open in a real browser
  | 'unsupported';

const DISMISS_KEY = 'installDismissedAt';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Chrome shows its own mini-infobar unless we take over.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    void setKV(DISMISS_KEY, Date.now());
    notify();
  });
}

export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOSDevice = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ reports itself as a Mac, and only the touch points give it away.
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return iOSDevice || iPadOS;
}

/**
 * WhatsApp, Instagram and Facebook all open links in an embedded WebView.
 * On Android that WebView marks itself with "wv"; the Meta apps add their own
 * FBAN/FBAV/Instagram tokens on both platforms.
 */
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|MicroMessenger/i.test(ua)) return true;
  if (/\bwv\b/.test(ua)) return true; // generic Android WebView
  // WhatsApp's Android WebView is a plain Chrome WebView; on iOS it is
  // SFSafariViewController, which cannot install either.
  if (isIOS() && /Safari/.test(ua) && !/CriOS|FxiOS|Version\//.test(ua)) return true;
  return false;
}

export function installCapability(): InstallCapability {
  if (typeof window === 'undefined') return 'unsupported';
  if (isStandalone()) return 'installed';
  if (deferred) return 'promptable';
  if (isInAppBrowser()) return 'in-app-browser';
  if (isIOS()) return 'ios-manual';
  return 'unsupported';
}

/** Fire the real Android installer. Must be called from a user gesture. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  try {
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === 'accepted') deferred = null;
    notify();
    return outcome;
  } catch {
    return 'unavailable';
  }
}

export async function snoozeInstallPrompt(): Promise<void> {
  await setKV(DISMISS_KEY, Date.now());
}

/**
 * Asking on every screen forever is how a prompt gets ignored. Once dismissed,
 * stay quiet for a week.
 */
export async function shouldOfferInstall(): Promise<boolean> {
  const cap = installCapability();
  if (cap === 'installed' || cap === 'unsupported') return false;
  const dismissedAt = await getKV<number>(DISMISS_KEY);
  if (dismissedAt && Date.now() - dismissedAt < SNOOZE_MS) return false;
  return true;
}
