import { useState } from 'react';
import { Button } from './Button';

interface Props {
  unit: string;
  currentCount: number;
  dailyTarget: number;
  maxDaily: number;
  onSubmit: (total: number) => Promise<void> | void;
  onClose: () => void;
}

/**
 * The escape hatch. On a low-end Android the pose model may be unusable, and
 * a challenge nobody can log into is worse than one logged on trust — the
 * spreadsheet this replaces was 100% self-reported anyway.
 */
export function ManualEntry({
  unit,
  currentCount,
  dailyTarget,
  maxDaily,
  onSubmit,
  onClose,
}: Props) {
  const [mode, setMode] = useState<'add' | 'set'>('add');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = Number(value);
  const nextTotal = mode === 'add' ? currentCount + (parsed || 0) : parsed || 0;
  const valid = Number.isFinite(parsed) && parsed >= 0 && nextTotal >= 0 && nextTotal <= maxDaily;

  const submit = async () => {
    if (!valid) {
      setError(`Enter a number between 0 and ${maxDaily.toLocaleString()}.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(Math.round(nextTotal));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Log manually"
        className="w-full max-w-md rounded-t-3xl border border-line bg-surface p-5 pb-8 sm:rounded-3xl"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line sm:hidden" />
        <h2 className="text-lg font-semibold">Log it yourself</h2>
        <p className="mt-1 text-sm text-muted">
          Today so far: <span className="tabular">{currentCount.toLocaleString()}</span> /{' '}
          {dailyTarget.toLocaleString()} {unit}
        </p>

        <div className="mt-4 flex gap-1 rounded-xl bg-surface2 p-1">
          {(['add', 'set'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-lg py-2 text-sm transition ${
                mode === m ? 'bg-flame font-semibold text-ink' : 'text-muted'
              }`}
            >
              {m === 'add' ? 'Add to today' : "Set today's total"}
            </button>
          ))}
        </div>

        <label className="label mt-4" htmlFor="manual-count">
          {mode === 'add' ? `How many ${unit} to add?` : `Total ${unit} today`}
        </label>
        <input
          id="manual-count"
          className="input tabular text-2xl"
          type="number"
          inputMode="numeric"
          min={0}
          max={maxDaily}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0"
        />

        {mode === 'add' && parsed > 0 && (
          <p className="mt-2 text-sm text-muted">
            New total: <span className="tabular text-text">{nextTotal.toLocaleString()}</span>{' '}
            {unit}
          </p>
        )}

        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={!value}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
