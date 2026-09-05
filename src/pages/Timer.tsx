import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/Button';
import { ManualEntry } from '@/components/ManualEntry';
import { ProgressBar } from '@/components/ProgressBar';
import { recordWorkout } from '@/features/challenges/api';
import { useChallenge, useTodayCount } from '@/features/challenges/hooks';
import { getActivity } from '@/lib/activities';
import {
  clearActiveTimer,
  getActiveTimer,
  saveActiveTimer,
  timerElapsedSec,
} from '@/lib/appMemory';
import { useAppStore } from '@/store/appStore';

function formatClock(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * The timed-activity screen: prayer, study, reading, planks.
 *
 * Real elapsed time is far better evidence than a typed number, and it costs a
 * fraction of what the rep counter costs — no camera, no model, no tuning.
 * Time is measured from wall-clock timestamps rather than counted ticks, so a
 * phone that sleeps or an app the OS evicts still records the minutes that
 * actually passed.
 */
export function Timer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { challenge } = useChallenge(id);
  const { count: alreadyToday, today, reload } = useTodayCount(challenge);
  const setLastResult = useAppStore((s) => s.setLastResult);

  const [elapsedSec, setElapsedSec] = useState(0);
  const [running, setRunning] = useState(false);
  const [restored, setRestored] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const baseRef = useRef(0);
  const accumulatedRef = useRef(0);
  const runningSinceRef = useRef<number | null>(null);

  const activity = challenge ? getActivity(challenge.activity_type) : null;
  const perUnitSec = activity?.unit === 'seconds' ? 1 : 60;

  const persist = useCallback(() => {
    if (!challenge) return;
    void saveActiveTimer({
      challengeId: challenge.id,
      date: today,
      base: baseRef.current,
      accumulatedSec: accumulatedRef.current,
      runningSince: runningSinceRef.current,
    });
  }, [challenge, today]);

  // Pick up a session the OS interrupted, or one left paused.
  useEffect(() => {
    if (!challenge || restored) return;
    void getActiveTimer().then((t) => {
      if (t && t.challengeId === challenge.id && t.date === today) {
        baseRef.current = t.base;
        accumulatedRef.current = t.accumulatedSec;
        runningSinceRef.current = t.runningSince;
        setElapsedSec(timerElapsedSec(t));
        setRunning(!!t.runningSince);
      } else {
        baseRef.current = alreadyToday;
      }
      setRestored(true);
    });
  }, [challenge, today, alreadyToday, restored]);

  // The display ticks once a second; the truth is always the timestamps.
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const live = runningSinceRef.current
        ? Math.max(0, Math.floor((Date.now() - runningSinceRef.current) / 1000))
        : 0;
      setElapsedSec(accumulatedRef.current + live);
    };
    tick();
    const t = window.setInterval(tick, 1000);
    // Recompute the moment the app comes back — the interval does not run
    // while a backgrounded tab is frozen, but the clock kept moving.
    const onVisible = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [running]);

  // Persist regularly and on the way out, so a kill costs at most a few seconds.
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(persist, 5000);
    const onHide = () => persist();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, [running, persist]);

  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    if (running && 'wakeLock' in navigator) {
      void navigator.wakeLock
        ?.request('screen')
        .then((l) => (lock = l))
        .catch(() => undefined);
    }
    return () => void lock?.release().catch(() => undefined);
  }, [running]);

  if (!challenge || !activity) {
    return (
      <AppShell title="Timer" back={`/challenge/${id}`}>
        <p className="py-16 text-center text-muted">Loading…</p>
      </AppShell>
    );
  }

  const earned = Math.floor(elapsedSec / perUnitSec);
  const total = baseRef.current + earned;
  const remaining = Math.max(0, challenge.daily_target - total);

  const startPause = () => {
    if (running) {
      accumulatedRef.current += runningSinceRef.current
        ? Math.max(0, Math.floor((Date.now() - runningSinceRef.current) / 1000))
        : 0;
      runningSinceRef.current = null;
      setRunning(false);
    } else {
      runningSinceRef.current = Date.now();
      setRunning(true);
    }
    persist();
  };

  const finish = async () => {
    setSaving(true);
    if (running) {
      accumulatedRef.current += runningSinceRef.current
        ? Math.max(0, Math.floor((Date.now() - runningSinceRef.current) / 1000))
        : 0;
      runningSinceRef.current = null;
      setRunning(false);
    }

    const finalEarned = Math.floor(accumulatedRef.current / perUnitSec);
    const finalTotal = baseRef.current + finalEarned;

    await recordWorkout({
      challengeId: challenge.id,
      date: today,
      count: Math.min(finalTotal, activity.maxDaily),
      source: 'timer',
    });
    await clearActiveTimer();
    await reload();

    setLastResult({
      challengeId: challenge.id,
      count: finalEarned,
      total: finalTotal,
      target: challenge.daily_target,
    });
    navigate(`/challenge/${challenge.id}/results`, { replace: true });
  };

  const discard = async () => {
    await clearActiveTimer();
    navigate(`/challenge/${challenge.id}`);
  };

  const saveManual = async (value: number) => {
    await recordWorkout({ challengeId: challenge.id, date: today, count: value, source: 'manual' });
    await clearActiveTimer();
    await reload();
    navigate(`/challenge/${challenge.id}`);
  };

  return (
    <AppShell title={challenge.name} back={`/challenge/${challenge.id}`}>
      <div className="space-y-6 pt-4 text-center">
        <div>
          <p className="text-sm uppercase tracking-widest text-muted">
            {activity.emoji} {activity.label}
          </p>
          <p className="mt-4 font-mono text-6xl font-bold tabular">{formatClock(elapsedSec)}</p>
          <p className="mt-2 text-muted">
            {earned.toLocaleString()} {challenge.unit} this session
          </p>
        </div>

        <div className="card text-left">
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span className="text-muted">Today</span>
            <span className="tabular">
              {total.toLocaleString()} / {challenge.daily_target.toLocaleString()} {challenge.unit}
            </span>
          </div>
          <ProgressBar value={total} max={challenge.daily_target} />
          {remaining > 0 ? (
            <p className="mt-2 text-sm text-muted">
              {remaining.toLocaleString()} {challenge.unit} to go today.
            </p>
          ) : (
            <p className="mt-2 text-sm font-semibold text-lime">Target reached 🎉</p>
          )}
        </div>

        <div className="space-y-2">
          <Button full onClick={startPause} variant={running ? 'secondary' : 'primary'}>
            {running ? 'Pause' : elapsedSec > 0 ? 'Resume' : 'Start'}
          </Button>
          <Button full onClick={finish} loading={saving} disabled={elapsedSec === 0}>
            Finish and save
          </Button>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button variant="ghost" onClick={() => setManualOpen(true)}>
              Enter it myself
            </Button>
            <Button variant="ghost" onClick={discard}>
              Discard
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted">
          The timer keeps running if you lock your phone or switch apps — it counts real elapsed
          time, not screen time.
        </p>
      </div>

      {manualOpen && (
        <ManualEntry
          unit={challenge.unit}
          currentCount={alreadyToday}
          dailyTarget={challenge.daily_target}
          maxDaily={activity.maxDaily}
          onSubmit={saveManual}
          onClose={() => setManualOpen(false)}
        />
      )}
    </AppShell>
  );
}
