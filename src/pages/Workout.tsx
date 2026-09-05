import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/Button';
import { ManualEntry } from '@/components/ManualEntry';
import { recordWorkout } from '@/features/challenges/api';
import { useChallenge, useTodayCount } from '@/features/challenges/hooks';
import { useCamera } from '@/features/workout/camera/useCamera';
import { useWorkoutEngine } from '@/features/workout/useWorkoutEngine';
import { useRecorder } from '@/features/workout/recording/useRecorder';
import { rejectionHint } from '@/features/workout/pushup/stateMachine';
import { configForExercise } from '@/features/workout/pushup/config';
import { getActivity } from '@/lib/activities';
import { clearActiveWorkout, getActiveWorkout, saveActiveWorkout } from '@/lib/appMemory';
import { useAppStore } from '@/store/appStore';

export function Workout() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { challenge } = useChallenge(id);
  const { count: alreadyToday, today, reload } = useTodayCount(challenge);
  const setLastResult = useAppStore((s) => s.setLastResult);
  const setLastClip = useAppStore((s) => s.setLastClip);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [phase, setPhase] = useState<'intro' | 'live' | 'paused' | 'saving'>('intro');
  const [manualOpen, setManualOpen] = useState(false);
  const [popKey, setPopKey] = useState(0);
  const [resumable, setResumable] = useState<number | null>(null);
  const [noFrames, setNoFrames] = useState(false);
  const [slow, setSlow] = useState(false);
  const [slowDismissed, setSlowDismissed] = useState(false);
  const [lenient, setLenient] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const slowTicks = useRef(0);

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
  const { ui, start, preload, pause, resume, stop, adjustReps } = useWorkoutEngine(
    videoRef,
    canvasRef,
    {
      onRep: persistRep,
      // Push-ups, squats and sit-ups are the same counter pointed at a
      // different joint, with a different idea of a valid body position.
      config: configForExercise(challenge?.activity_type ?? 'pushups', lenient),
    },
  );

  const recorder = useRecorder(videoRef);

  // Fetch the model the moment this screen opens. A download failure then
  // shows up here, with an explanation and a retry, instead of after the
  // camera is live where it is indistinguishable from a broken counter.
  useEffect(() => {
    void preload();
  }, [preload]);

  useEffect(() => setPopKey((k) => k + 1), [ui.reps]);

  // Feed the recorder the numbers it burns into the frame. Ref-based, so this
  // costs nothing per frame and never triggers a render.
  useEffect(() => {
    if (!challenge) return;
    recorder.setOverlay({
      reps: ui.reps,
      unit: challenge.unit,
      challengeName: challenge.name,
      targetLine: `${alreadyToday + ui.reps} / ${challenge.daily_target} today`,
    });
  }, [ui.reps, challenge, alreadyToday, recorder]);
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

  /**
   * Entry-level Androids can run this pipeline at single-digit frame rates.
   * Below roughly 10fps a rep is only a handful of samples, the smoother lags
   * the real movement, and depth gets missed — the counter quietly
   * under-counts. Better to say so and offer the manual route than to let
   * someone finish a set believing the number.
   */
  useEffect(() => {
    if (phase !== 'live' || ui.fps === 0) return;
    if (ui.fps < 10) {
      slowTicks.current += 1;
      if (slowTicks.current >= 3) setSlow(true);
    } else {
      slowTicks.current = 0;
      setSlow(false);
    }
  }, [ui.fps, phase]);

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

  // Only nag once it has clearly been stuck rather than merely settling.
  const [stuckReason, setStuckReason] = useState<string | null>(null);
  useEffect(() => {
    if (phase !== 'live' || ui.reps > 0 || !ui.blockedBy || ui.blockedBy === 'calibrating') {
      setStuckReason(null);
      return;
    }
    const label: Record<string, string> = {
      'no-person': "can't see anyone in frame",
      'not-enough-joints': 'your shoulders, elbows and hips need to be in frame',
      orientation: 'this does not look like a push-up position yet',
      'body-not-straight': 'keep your hips in line with your shoulders',
    };
    const t = window.setTimeout(() => setStuckReason(label[ui.blockedBy!] ?? ui.blockedBy), 4000);
    return () => window.clearTimeout(t);
  }, [ui.blockedBy, ui.reps, phase]);

  const activity = challenge ? getActivity(challenge.activity_type) : null;
  const sessionTotal = alreadyToday + ui.reps;
  const remaining = challenge ? Math.max(0, challenge.daily_target - sessionTotal) : 0;
  const isIntro = phase === 'intro';

  const begin = async (seed = 0) => {
    if (!challenge) return;

    // Never go live with a counter that cannot count — that is precisely the
    // silent failure this screen used to have.
    const counterReady = await start(seed);
    if (!counterReady) return;

    const ok = await camera.start('user');
    if (!ok) return;

    baseRef.current = alreadyToday;
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

    // Stop the recorder BEFORE the camera, or the last second of frames is lost.
    if (recorder.status === 'recording') {
      const clip = await recorder.stop();
      if (clip) setLastClip(clip);
    }
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
    if (recorder.status === 'recording') {
      const clip = await recorder.stop();
      if (clip) setLastClip(clip);
    }
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
              Prop the phone far enough back that your <strong className="text-text">whole body</strong>{' '}
              fits in the picture, head to feet — usually 2–3 metres. Beside you or straight in
              front both work. Good light on you, not behind you.
            </p>
            {challenge.activity_type === 'squats' && (
              <p className="mt-2 text-sm text-muted">
                Stand facing the camera or side-on. It watches your knees, so they need to be in
                shot for the whole movement.
              </p>
            )}
            {challenge.activity_type === 'situps' && (
              <p className="mt-2 text-sm text-muted">
                Lie side-on to the camera with your knees bent. It watches the angle between your
                torso and your thighs.
              </p>
            )}

            <ul className="mt-5 space-y-2 text-sm text-muted">
              <li>📏 Whole body in frame — legs included, not just your top half</li>
              <li>📱 Beside you or in front — both work</li>
              <li>💡 Light on you, window in front rather than behind</li>
              <li>🔒 The video never leaves this phone — only your count is saved</li>
              <li>🎥 Tap Record during the set to keep a clip with your count on it</li>
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

            {ui.modelStatus === 'loading' && (
              <p className="mt-5 text-sm text-muted">
                Downloading the rep counter (about 15MB, once)… it is cached after this, and works
                offline afterwards.
              </p>
            )}

            {ui.modelStatus === 'error' && (
              <div className="card mt-5 border-red-500/40 bg-red-500/10 text-sm">
                <p className="font-medium">The rep counter could not load.</p>
                <p className="mt-1 text-muted">
                  It downloads once from an external host; a blocked or very slow connection stops
                  it. Without it the camera cannot count. {ui.modelError}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => void preload()}>
                    Try again
                  </Button>
                  <Button onClick={() => setManualOpen(true)}>Count it myself</Button>
                </div>
              </div>
            )}

            <label className="mt-5 flex items-center gap-3 text-sm text-muted">
              <input
                type="checkbox"
                checked={lenient}
                onChange={(e) => setLenient(e.target.checked)}
                className="h-5 w-5 accent-[#FF6B35]"
              />
              Counting missing reps? Use relaxed detection
            </label>
          </div>

          <div className="space-y-2 pt-6">
            <Button
              full
              onClick={() => void begin(0)}
              loading={camera.status === 'requesting' || ui.modelStatus === 'loading'}
              disabled={ui.modelStatus === 'error'}
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
              {recorder.status !== 'unsupported' && (
                <button
                  onClick={() => {
                    if (recorder.status === 'recording') {
                      void recorder.stop().then((clip) => clip && setLastClip(clip));
                    } else {
                      recorder.start({
                        reps: ui.reps,
                        unit: challenge.unit,
                        challengeName: challenge.name,
                        targetLine: `${sessionTotal} / ${challenge.daily_target} today`,
                      });
                    }
                  }}
                  aria-label={recorder.status === 'recording' ? 'Stop recording' : 'Record this set'}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs backdrop-blur ${
                    recorder.status === 'recording'
                      ? 'bg-red-600/80 text-white'
                      : 'bg-black/40 text-white/80'
                  }`}
                >
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      recorder.status === 'recording' ? 'animate-pulse bg-white' : 'bg-red-500'
                    }`}
                  />
                  {recorder.status === 'recording'
                    ? `${Math.floor(recorder.elapsedMs / 60000)}:${String(
                        Math.floor((recorder.elapsedMs % 60000) / 1000),
                      ).padStart(2, '0')}`
                    : 'Record'}
                </button>
              )}
              <button
                onClick={() => void camera.flip()}
                aria-label="Switch camera"
                className="rounded-full bg-black/40 px-3 py-1.5 text-xs text-white/80 backdrop-blur"
              >
                Flip
              </button>
              <button
                onClick={() => setShowDiagnostics((v) => !v)}
                aria-label="Counter diagnostics"
                className="rounded-full bg-black/40 px-3 py-1.5 text-xs text-white/70 backdrop-blur tabular"
              >
                {ui.fps} fps · {ui.delegate}
              </button>
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

          {/* Why isn't it counting? — tap the fps chip */}
          {showDiagnostics && (
            <div className="absolute inset-x-4 top-[12%] rounded-2xl bg-black/85 p-4 text-xs text-white backdrop-blur">
              <p className="mb-2 text-sm font-medium">What the counter sees</p>
              <dl className="grid grid-cols-2 gap-y-1">
                <dt className="text-white/60">Person detected</dt>
                <dd>{ui.detected ? 'yes' : 'no'}</dd>
                <dt className="text-white/60">Joints in frame</dt>
                <dd>{Math.round(ui.coverage * 100)}%</dd>
                <dt className="text-white/60">Framing</dt>
                <dd>
                  {ui.view === 'side'
                    ? 'side-on'
                    : ui.view === 'facing'
                      ? 'facing camera'
                      : 'upright — not a push-up position'}
                </dd>
                <dt className="text-white/60">Foreshortening</dt>
                <dd className="tabular">
                  {ui.foreshortening.toFixed(2)} (torso {ui.torsoRatio.toFixed(2)}, legs{' '}
                  {Number.isFinite(ui.legRatio) ? ui.legRatio.toFixed(2) : '—'})
                </dd>
                <dt className="text-white/60">Elbow angle</dt>
                <dd className="tabular">{Math.round(ui.elbowAngle)}°</dd>
                <dt className="text-white/60">Body straightness</dt>
                <dd className="tabular">{Math.round(ui.straightness)}°</dd>
                <dt className="text-white/60">State</dt>
                <dd>{ui.state}</dd>
                <dt className="text-white/60">Counter</dt>
                <dd>{ui.modelStatus}</dd>
                <dt className="text-white/60">Whole body in frame</dt>
                <dd>{ui.fullBody ? 'yes' : `no (${ui.framingProblem ?? '—'})`}</dd>
                <dt className="text-white/60">Blocked by</dt>
                <dd className="text-flame">{ui.blockedBy ?? 'nothing — counting'}</dd>
              </dl>
              <p className="mt-2 text-white/50">
                A rep needs the elbow angle to go above 150° then below 100° and back, taking more
                than half a second.
              </p>
              <Button variant="secondary" full className="mt-3" onClick={() => setShowDiagnostics(false)}>
                Close
              </Button>
            </div>
          )}

          {/* Framing: shown until the shot is right, then it gets out of the way. */}
          {(ui.state === 'idle' || ui.state === 'calibrating') && (
            <>
              {/* Corner brackets marking the shot to fill. */}
              <div className="pointer-events-none absolute inset-6 top-24 bottom-40">
                {(
                  [
                    'left-0 top-0 border-l-2 border-t-2 rounded-tl-xl',
                    'right-0 top-0 border-r-2 border-t-2 rounded-tr-xl',
                    'left-0 bottom-0 border-l-2 border-b-2 rounded-bl-xl',
                    'right-0 bottom-0 border-r-2 border-b-2 rounded-br-xl',
                  ] as const
                ).map((cls) => (
                  <span
                    key={cls}
                    className={`absolute h-10 w-10 ${cls} ${
                      ui.fullBody ? 'border-lime' : 'border-white/40'
                    } transition-colors`}
                  />
                ))}
              </div>

              <div className="absolute inset-x-4 top-[16%] rounded-2xl bg-black/75 px-4 py-3 text-center text-sm text-white backdrop-blur">
                {ui.framingProblem ? (
                  <>
                    <p className="font-medium">{ui.coaching}</p>
                    <p className="mt-1 text-xs text-white/60">
                      The counter needs your legs in shot to tell a push-up from standing up.
                    </p>
                  </>
                ) : (
                  <p className="font-medium text-lime">
                    {ui.state === 'calibrating'
                      ? 'Framing looks good — get into position and hold still'
                      : 'Ready'}
                  </p>
                )}
              </div>
            </>
          )}

          {/* Stuck for a while? Say what is blocking, without being asked. */}
          {!showDiagnostics && stuckReason && ui.state !== 'calibrating' && ui.state !== 'idle' && (
            <button
              onClick={() => setShowDiagnostics(true)}
              className="absolute inset-x-4 top-[12%] rounded-2xl bg-black/75 px-4 py-3 text-left text-sm text-white backdrop-blur"
            >
              <span className="font-medium">Not counting: {stuckReason}</span>
              <span className="mt-0.5 block text-xs text-white/60">Tap for details</span>
            </button>
          )}

          {/* Low frame rate — the counter will under-count here */}
          {slow && !noFrames && !slowDismissed && (
            <div className="absolute inset-x-4 top-[18%] rounded-2xl bg-black/80 p-4 text-sm text-white backdrop-blur">
              <p className="font-medium">
                This phone is running the counter at {ui.fps} fps.
              </p>
              <p className="mt-1 text-white/70">
                Below about 10 it starts missing reps. Counting still works — just check the number
                before you finish, or log it yourself.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => setSlowDismissed(true)}>
                  Keep counting
                </Button>
                <Button onClick={() => setManualOpen(true)}>Count it myself</Button>
              </div>
            </div>
          )}

          {/* Coaching */}
          {!noFrames && !slow && (ui.coaching || ui.formWarning || (ui.lastRejection && !ui.coaching)) && (
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
