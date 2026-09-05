import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/Button';
import { ManualEntry } from '@/components/ManualEntry';
import { recordWorkout } from '@/features/challenges/api';
import { useChallenge, useTodayCount } from '@/features/challenges/hooks';
import { useCamera } from '@/features/workout/camera/useCamera';
import { useWorkoutEngine } from '@/features/workout/useWorkoutEngine';
import { rejectionHint } from '@/features/workout/pushup/stateMachine';
import { getActivity } from '@/lib/activities';
import { clearActiveWorkout, getActiveWorkout, saveActiveWorkout } from '@/lib/appMemory';
import { useAppStore } from '@/store/appStore';

export function Workout() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { challenge } = useChallenge(id);
  const { count: alreadyToday, today, reload } = useTodayCount(challenge);
  const setLastResult = useAppStore((s) => s.setLastResult);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [phase, setPhase] = useState<'intro' | 'live' | 'paused' | 'saving'>('intro');
  const [manualOpen, setManualOpen] = useState(false);
  const [popKey, setPopKey] = useState(0);
  const [resumable, setResumable] = useState<number | null>(null);
  const [noFrames, setNoFrames] = useState(false);

  const baseRef = useRef(0);

  const persistRep = useCallback(
    (reps: number) => {
      if (!challenge) return;
      void saveActiveWorkout({
        challengeId: challenge.id,
        date: today,
        base: baseRef.current,
        reps,
        startedAt: Date.now(),
      });
    },
    [challenge, today],
  );

  const camera = useCamera(videoRef);
  const { ui, start, pause, resume, stop, adjustReps } = useWorkoutEngine(videoRef, canvasRef, {
    onRep: persistRep,
  });

  useEffect(() => setPopKey((k) => k + 1), [ui.reps]);
  useEffect(() => stop, [stop]);

  useEffect(() => {
    if (!challenge) return;
    void getActiveWorkout().then((active) => {
      if (
        active &&
        active.challengeId === challenge.id &&
        active.date === today &&
        active.reps > 0
      ) {
        setResumable(active.reps);
      }
    });
  }, [challenge, today]);

  /**
   * A stream can be live while the element never paints — a paused <video>, a
   * track the OS handed over dead, a facing mode the device does not really
   * support. Rather than leaving the participant staring at black, detect it
   * and offer the two things that actually help.
   */
  useEffect(() => {
    if (phase !== 'live' || camera.status !== 'ready') {
      setNoFrames(false);
      return;
    }
    const timer = window.setTimeout(() => {
      const v = videoRef.current;
      setNoFrames(!v || v.videoWidth === 0 || v.readyState < 2);
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [phase, camera.status]);

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

  const activity = challenge ? getActivity(challenge.activity_type) : null;
  const sessionTotal = alreadyToday + ui.reps;
  const remaining = challenge ? Math.max(0, challenge.daily_target - sessionTotal) : 0;
  const isIntro = phase === 'intro';

  const begin = async (seed = 0) => {
    if (!challenge) return;
    const ok = await camera.start('user');
    if (!ok) return;
    baseRef.current = alreadyToday;
    await start(seed);
    if (seed > 0) persistRep(seed);
    setPhase('live');
    // The element is already mounted, but re-binding after the phase switch
    // costs nothing and closes the last ordering gap.
    requestAnimationFrame(() => camera.attach());
  };

  const finish = async () => {
    if (!challenge) return;
    setPhase('saving');
    pause();
    camera.stop();

    await recordWorkout({
      challengeId: challenge.id,
      date: today,
      count: sessionTotal,
      source: 'cv',
    });
    await clearActiveWorkout();
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
    if (!challenge) return;
    await recordWorkout({ challengeId: challenge.id, date: today, count: total, source: 'manual' });
    await clearActiveWorkout();
    await reload();
    setLastResult({
      challengeId: challenge.id,
      count: total - alreadyToday,
      total,
      target: challenge.daily_target,
    });
    navigate(`/challenge/${challenge.id}/results`, { replace: true });
  };

  const abandon = async () => {
    if (!challenge) return;
    stop();
    camera.stop();
    // Anything counted still belongs to the participant, so it is banked
    // rather than dropped — stopping means "stop counting", not "delete my reps".
    if (ui.reps > 0) {
      await recordWorkout({
        challengeId: challenge.id,
        date: today,
        count: alreadyToday + ui.reps,
        source: 'cv',
      });
    }
    await clearActiveWorkout();
    navigate(`/challenge/${challenge.id}`);
  };

  if (!challenge || !activity) {
    return <p className="p-8 text-center text-muted">Loading…</p>;
  }

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-black">
      {/*
        Video and canvas are mounted ONCE, outside the phase branches. Putting
        them inside the live branch meant the element did not exist yet when the
        stream arrived, so the camera switched on and nothing ever displayed.
      */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        onLoadedMetadata={() => camera.attach()}
        className={`absolute inset-0 h-full w-full scale-x-[-1] object-cover transition-opacity duration-300 ${
          camera.status === 'ready' ? 'opacity-100' : 'opacity-0'
        } ${isIntro ? 'opacity-30' : ''}`}
      />
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full scale-x-[-1] object-cover ${
          isIntro ? 'hidden' : ''
        }`}
        aria-hidden
      />

      {isIntro ? (
        <div className="absolute inset-0 flex flex-col justify-between overflow-y-auto bg-ink/80 p-5 backdrop-blur-sm">
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

            {resumable !== null && (
              <div className="card mt-5 border-flame/40 bg-flame/10">
                <p className="text-sm">
                  You were at <span className="tabular font-semibold">{resumable}</span>{' '}
                  {challenge.unit} when this was interrupted.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => setResumable(null)}>
                    Start fresh
                  </Button>
                  <Button onClick={() => void begin(resumable)}>Continue from {resumable}</Button>
                </div>
              </div>
            )}

            {camera.error && (
              <div className="card mt-5 border-red-500/40 bg-red-500/10 text-sm">
                {camera.error}
              </div>
            )}

            {ui.modelStatus === 'error' && (
              <div className="card mt-3 border-red-500/40 bg-red-500/10 text-sm">
                {ui.modelError}
              </div>
            )}
          </div>

          <div className="space-y-2 pt-6">
            <Button
              full
              onClick={() => void begin(0)}
              loading={camera.status === 'requesting' || ui.modelStatus === 'loading'}
            >
              {ui.modelStatus === 'loading' ? 'Loading counter…' : 'Start workout'}
            </Button>
            <Button full variant="secondary" onClick={() => setManualOpen(true)}>
              Count it myself instead
            </Button>
            <p className="pt-1 text-center text-xs text-muted">
              Camera not working on your phone? The manual option keeps you in the challenge.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Top bar */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent p-4 pt-[max(1rem,env(safe-area-inset-top))]">
            <button
              onClick={() => void abandon()}
              className="rounded-full bg-black/40 px-4 py-2 text-sm text-white backdrop-blur"
            >
              Done for now
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void camera.flip()}
                aria-label="Switch camera"
                className="rounded-full bg-black/40 px-3 py-1.5 text-xs text-white/80 backdrop-blur"
              >
                Flip
              </button>
              <span className="rounded-full bg-black/40 px-3 py-1.5 text-xs text-white/70 backdrop-blur tabular">
                {ui.fps} fps · {ui.delegate}
              </span>
            </div>
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

          {/* Black-screen rescue */}
          {noFrames && (
            <div className="absolute inset-x-4 top-[18%] rounded-2xl bg-red-950/90 p-4 text-center text-sm text-white backdrop-blur">
              <p className="font-medium">The camera is on but no picture is coming through.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => void camera.flip()}>
                  Try other camera
                </Button>
                <Button onClick={() => setManualOpen(true)}>Count it myself</Button>
              </div>
            </div>
          )}

          {/* Coaching */}
          {!noFrames && (ui.coaching || ui.formWarning || (ui.lastRejection && !ui.coaching)) && (
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
                onClick={() => {
                  adjustReps(-1);
                  persistRep(Math.max(0, ui.reps - 1));
                }}
                aria-label="Remove one rep"
                className="h-12 w-12 rounded-full bg-white/10 text-2xl text-white backdrop-blur"
              >
                −
              </button>
              <span className="text-xs text-white/60">miscounted?</span>
              <button
                onClick={() => {
                  adjustReps(1);
                  persistRep(ui.reps + 1);
                }}
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
        </>
      )}

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
