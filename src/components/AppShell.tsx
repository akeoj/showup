import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnline, useSyncStatus } from '@/features/challenges/hooks';

interface Props {
  title?: string;
  back?: string | (() => void);
  action?: ReactNode;
  children: ReactNode;
  /** Full-bleed pages (the camera) skip the padded container. */
  bare?: boolean;
}

export function AppShell({ title, back, action, children, bare }: Props) {
  const navigate = useNavigate();

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col">
      {(title || back || action) && (
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line/60 bg-ink/90 px-4 py-3 backdrop-blur">
          {back && (
            <button
              onClick={() => (typeof back === 'string' ? navigate(back) : back())}
              aria-label="Go back"
              className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-muted hover:text-text"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M15 19l-7-7 7-7"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
          {action}
        </header>
      )}

      <ConnectionBanner />

      <main className={bare ? 'flex-1' : 'flex-1 px-4 pb-24 pt-4'}>{children}</main>
    </div>
  );
}

export function ConnectionBanner() {
  const online = useOnline();
  const sync = useSyncStatus();

  if (online && sync.pending === 0) return null;

  return (
    <div
      role="status"
      className={`px-4 py-2 text-center text-sm ${
        online ? 'bg-flame/15 text-flame' : 'bg-surface2 text-muted'
      }`}
    >
      {!online && sync.pending > 0 && (
        <>Offline — {sync.pending} workout{sync.pending > 1 ? 's' : ''} saved on this phone.</>
      )}
      {!online && sync.pending === 0 && <>Offline — your workouts will still be saved.</>}
      {online && sync.pending > 0 && (
        <>{sync.syncing ? 'Syncing…' : `${sync.pending} workout(s) waiting to sync`}</>
      )}
    </div>
  );
}
