import { useState } from 'react';
import { Button } from './Button';
import { claimTransfer, type TransferResult } from '@/features/challenges/api';
import { useAppStore } from '@/store/appStore';

/**
 * Entering a transfer code on the new install.
 *
 * This is the other half of the iOS storage split: the home-screen app cannot
 * see anything Safari stored, so the only way back to a week of workouts is a
 * code the participant carries across by hand.
 */
export function RestoreProgress({ onDone }: { onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransferResult | null>(null);
  const setNickname = useAppStore((s) => s.setNickname);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await claimTransfer(code);
      if (r.nickname) await setNickname(r.nickname);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not restore.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full py-2 text-center text-sm text-muted underline underline-offset-4"
      >
        Already used Showup in your browser? Restore your progress
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Restore progress"
        className="w-full max-w-md rounded-t-3xl border border-line bg-surface p-5 pb-8 sm:rounded-3xl"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line sm:hidden" />

        {result ? (
          <>
            <h2 className="text-lg font-semibold">Welcome back{result.nickname ? `, ${result.nickname}` : ''}</h2>
            <p className="mt-2 text-sm text-muted">
              Moved {result.challenges_moved} challenge
              {result.challenges_moved === 1 ? '' : 's'} and {result.workouts_moved} day
              {result.workouts_moved === 1 ? '' : 's'} of progress onto this app. Your streak and
              your place on the leaderboard came with them.
            </p>
            <Button
              full
              className="mt-5"
              onClick={() => {
                setOpen(false);
                onDone?.();
              }}
            >
              Done
            </Button>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold">Restore your progress</h2>
            <p className="mt-1 text-sm text-muted">
              Open Showup in the browser you were using, tap{' '}
              <strong className="text-text">Move to another device</strong>, and enter the code it
              gives you here.
            </p>

            <label className="label mt-4" htmlFor="transfer-code">
              Transfer code
            </label>
            <input
              id="transfer-code"
              className="input text-center font-mono text-2xl uppercase tracking-[0.25em]"
              value={code}
              maxLength={8}
              autoFocus
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="XP86WEB7"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />

            {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={submit} loading={busy} disabled={code.length < 8}>
                Restore
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
