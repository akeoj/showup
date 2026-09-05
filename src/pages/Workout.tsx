import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/Button';
import { ManualEntry } from '@/components/ManualEntry';
import { recordWorkout } from '@/features/challenges/api';
import { useChallenge, useTodayCount } from '@/features/challenges/hooks';
import { useCamera } from '@/features/workout/camera/useCamera';
import { useWorkoutEngine } from '@/features/workout/useWorkoutEngine';
import { rejectionHint } from '@/features/workout/pushup/stateMachine';
import { getActivity } from '@/lib/activities';
import { useAppStore } from '@/store/appStore';

export function Workout() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { challenge } = useChallenge(id);
  const { count: alreadyToday, today, reload } = useTodayCount(challenge);
  const setLastResult = useAppStore((s) => s.setLastResult);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const camera = useCamera(videoRef);
  const { ui, start, pause, resume, stop, adjustReps } = useWorkoutEngine(videoRef, canvasRef);

  const [phase, setPhase] = useState<'intro' | 'live' | 'paused' | 'saving'>('intro');
  const [manualOpen, setManualOpen] = useState(false);
  const [popKey, setPopKey] = useState(0);

  useEffect(() => setPopKey((k) => k + 1), [ui.reps]);
  useEffect(() => stop, [stop]);

  // Keep the screen awake during a set — the phone is on the floor, untouched.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    if (phase === 'live' && 'wakeLock' in navigator) {
      void navigator.wakeLock
        ?.request('screen')
        .then((l) => (lock = l))
        .catch(() => undefined);
    }
    return () => void lock?.release().catch(() => undefined);
  }, [phase]);

  if (!challenge) {
    return <p className="p-8 text-center text-muted">Loading…</p>;
  }

  const activity = getActivity(challenge.activity_type);
  const sessionTotal = alreadyToday + ui.reps;
  const remaining = Math.max(0, challenge.daily_target - sessionTotal);

  const begin = async () => {
    const ok = await camera.start('user');
    if (!ok) return;
    await start(0);
    setPhase('live');
  };

  const finish = async () => {
    setPhase('saving');
    pause();
    camera.stop();

    await recordWorkout({
      challengeId: challenge.id,
      date: today,
      count: sessionTotal,
      source: 'cv',
    });
    await reload();

    setLastResult({
      challengeId: challenge.id,
      count: ui.reps,
      total: sessionTotal,
      target: challenge.daily_target,
    });
    navigate(`/challenge/${challenge.id}/results`, { replace: true });
  };

  const saveManual = async (total: number) => {
    await recordWorkout({ challengeId: challenge.id, date: today, count: total, source: 'manual' });
    await reload();
    setLastResult({
      challengeId: challenge.id,
      count: total - alreadyToday,
      total,
      target: challenge.daily_target,
    });
    navigate(`/challenge/${challenge.id}/results`, { replace: true });
  };

  // ---- Intro / permission screen -----------------------------------------
  if (phase === 'intro') {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-between p-5">
        <div>
          <button
            onClick={() => navigate(`/challenge/${challenge.id}`)}
            className="-ml-2 mb-4 px-2 py-1 text-sm text-muted"
          >
            ← Back
          </button>

          <h1 className="text-2xl font-bold">Set up your phone</h1>
          <p className="mt-2 text-muted">
            Prop the phone on its side about 1–2 metres away, so your head, shoulders and hips are
            all in frame. Good light in front of you, not behind.
          </p>

          <ul className="mt-5 space-y-2 text-sm text-muted">
            <li>📱 Phone to your side, not in front of your head</li>
            <li>💡 Light on you, window in front rather than behind</li>
            <li>🔒 The video never leaves this phone — only your count is saved</li>
          </ul>

          {camera.error && (
            <div className="card mt-5 border-red-500/40 bg-red-500/10 text-sm">{camera.error}</div>
          )}

          {ui.modelStatus === 'error' && (
            <div className="card mt-3 border-red-500/40 bg-red-500/10 text-sm">
              {ui.modelError}
            </div>
          )}
        </div>

        <div className="space-y-2 pt-6">
          <Button full onClick={begin} loading={camera.status === 'requesting' || ui.modelStatus === 'loading'}>
            {ui.modelStatus === 'loading' ? 'Loading counter…' : 'Start workout'}
          </Button>
          <Button full variant="secondary" onClick={() => setManualOpen(true)}>
            Count it myself instead
          </Button>
          <p className="pt-1 text-center text-xs text-muted">
            Camera not working on your phone? The manual option keeps you in the challenge.
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
      </div>
    );
  }

  // ---- Live camera --------------------------------------------------------
  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-black">
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 h-full w-full scale-x-[-1] object-cover"
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full scale-x-[-1] object-cover"
        aria-hidden
      />

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button
          onClick={() => {
            stop();
            camera.stop();
            navigate(`/challenge/${challenge.id}`);
          }}
          className="rounded-full bg-black/40 px-4 py-2 text-sm text-white backdrop-blur"
        >
          Cancel
        </button>
        <span className="rounded-full bg-black/40 px-3 py-1.5 text-xs text-white/70 backdrop-blur tabular">
          {ui.fps} fps · {ui.delegate}
        </span>
      </div>

      {/* Counter */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center">
        <p
          key={popKey}
          className="animate-pop text-[7rem] font-bold leading-none text-white tabular drop-shadow-[0_2px_20px_rgba(0,0,0,0.9)]"
        >
          {ui.reps}
        </p>
        <p className="text-sm uppercase tracking-[0.3em] text-white/70">{challenge.unit}</p>
        <p className="mt-2 text-white/80 tabular">
          {sessionTotal.toLocaleString()} / {challenge.daily_target.toLocaleString()} today
          {remaining > 0 && <> · {remaining.toLocaleString()} to go</>}
        </p>
      </div>

      {/* Coaching */}
      {(ui.coaching || ui.formWarning || (ui.lastRejection && !ui.coaching)) && (
        <div
          role="status"
          className="absolute inset-x-4 top-[22%] rounded-2xl bg-black/65 px-4 py-3 text-center text-sm text-white backdrop-blur"
        >
          {ui.coaching ??
            ui.formWarning ??
            (ui.lastRejection ? rejectionHint(ui.lastRejection) : null)}
        </div>
      )}

      {/* Bottom controls */}
      <div className="absolute inset-x-0 bottom-0 space-y-3 bg-gradient-to-t from-black/80 to-transparent p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => adjustReps(-1)}
            aria-label="Remove one rep"
            className="h-12 w-12 rounded-full bg-white/10 text-2xl text-white backdrop-blur"
          >
            −
          </button>
          <span className="text-xs text-white/60">miscounted?</span>
          <button
            onClick={() => adjustReps(1)}
            aria-label="Add one rep"
            className="h-12 w-12 rounded-full bg-white/10 text-2xl text-white backdrop-blur"
          >
            +
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {phase === 'live' ? (
            <Button
              variant="secondary"
              onClick={() => {
                pause();
                setPhase('paused');
              }}
            >
              Pause
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                resume();
                setPhase('live');
              }}
            >
              Resume
            </Button>
          )}
          <Button onClick={finish} loading={phase === 'saving'}>
            Finish
          </Button>
        </div>
      </div>
    </div>
  );
}
