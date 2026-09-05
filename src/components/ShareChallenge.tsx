import { useState } from 'react';
import { Button } from './Button';

const BASE =
  (import.meta.env.VITE_PUBLIC_URL as string | undefined)?.replace(/\/$/, '') ||
  (typeof window !== 'undefined' ? window.location.origin : '');

export function joinUrl(code: string): string {
  return `${BASE}/join/${code}`;
}

export function inviteText(name: string, target: number, unit: string, code: string): string {
  return `💪 Join my "${name}" challenge — ${target.toLocaleString()} ${unit} every day.\n\nTap to join: ${joinUrl(code)}\nOr enter code ${code} at ${BASE}`;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older Android WebViews and any non-secure context land here.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }
}

interface Props {
  name: string;
  code: string;
  dailyTarget: number;
  unit: string;
}

export function ShareChallenge({ name, code, dailyTarget, unit }: Props) {
  const [copied, setCopied] = useState<'code' | 'link' | 'text' | null>(null);
  const message = inviteText(name, dailyTarget, unit, code);

  const flash = (what: 'code' | 'link' | 'text') => {
    setCopied(what);
    setTimeout(() => setCopied(null), 1800);
  };

  const shareNative = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: name, text: message });
        return;
      } catch {
        /* user dismissed — fall through to copy */
      }
    }
    if (await copy(message)) flash('text');
  };

  return (
    <div className="space-y-3">
      <div className="card text-center">
        <p className="text-sm text-muted">Challenge code</p>
        <p className="my-2 select-all font-mono text-4xl font-bold tracking-[0.2em] text-flame">
          {code}
        </p>
        <button
          onClick={async () => (await copy(code)) && flash('code')}
          className="text-sm text-muted underline underline-offset-4"
        >
          {copied === 'code' ? 'Copied' : 'Copy code'}
        </button>
      </div>

      {/* WhatsApp first: this is where Nigerian challenge groups actually live. */}
      <a
        href={`https://wa.me/?text=${encodeURIComponent(message)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-5 py-3.5 font-semibold text-black transition hover:brightness-110"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M17.5 14.4c-.3-.2-1.7-.9-2-1-.3-.1-.5-.2-.7.1-.2.3-.7 1-.9 1.2-.2.2-.3.2-.6.1-1.6-.8-2.7-1.5-3.8-3.4-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.5s-.7-1.6-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.3 5.2 4.6 1.9.8 2.7.9 3.6.8.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.4zM12 2a10 10 0 00-8.6 15L2 22l5.2-1.4A10 10 0 1012 2z" />
        </svg>
        Share on WhatsApp
      </a>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          onClick={async () => (await copy(joinUrl(code))) && flash('link')}
        >
          {copied === 'link' ? 'Link copied' : 'Copy link'}
        </Button>
        <Button variant="secondary" onClick={shareNative}>
          {copied === 'text' ? 'Copied' : 'More…'}
        </Button>
      </div>

      <p className="break-all rounded-xl bg-surface2 px-3 py-2 text-center text-xs text-muted">
        {joinUrl(code)}
      </p>
    </div>
  );
}
