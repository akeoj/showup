import { useCallback, useEffect, useRef, useState } from 'react';
import { firstPose, getDelegate, loadPoseLandmarker, type PoseLandmarker } from './pose/poseEngine';
import { computeMetrics, type Landmark } from './pushup/geometry';
import { PushupCounter, type CounterState, type RejectReason } from './pushup/stateMachine';
import { DEFAULT_PUSHUP_CONFIG, type PushupConfig } from './pushup/config';

export interface WorkoutUiState {
  reps: number;
  state: CounterState;
  coaching: string | null;
  formWarning: string | null;
  lastRejection: RejectReason | null;
  fps: number;
  depth: number;
  modelStatus: 'idle' | 'loading' | 'ready' | 'error';
  modelError: string | null;
  delegate: 'GPU' | 'CPU';
}

const SKELETON: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28],
];

/**
 * Owns the per-frame loop.
 *
 * Frames are processed at camera rate but React is only told about *events* —
 * a counted rep, a state change, a new coaching line. The counter, angles and
 * skeleton all live in refs and on a canvas, so a 30fps pipeline does not mean
 * 30 re-renders a second (and certainly not 30 IndexedDB writes).
 */
export function useWorkoutEngine(
  videoRef: React.RefObject<HTMLVideoElement>,
  canvasRef: React.RefObject<HTMLCanvasElement>,
  options: { config?: Partial<PushupConfig>; onRep?: (reps: number) => void } = {},
) {
  const { config, onRep } = options;

  const [ui, setUi] = useState<WorkoutUiState>({
    reps: 0,
    state: 'idle',
    coaching: null,
    formWarning: null,
    lastRejection: null,
    fps: 0,
    depth: 0,
    modelStatus: 'idle',
    modelError: null,
    delegate: 'GPU',
  });

  const counterRef = useRef<PushupCounter | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const lastVideoTimeRef = useRef(-1);
  const onRepRef = useRef(onRep);
  onRepRef.current = onRep;

  // Throttle for the values that change every frame but only matter visually.
  const frameCountRef = useRef(0);
  const fpsWindowStart = useRef(0);
  const lastPushRef = useRef(0);

  const cfg: PushupConfig = { ...DEFAULT_PUSHUP_CONFIG, ...config };

  const draw = useCallback(
    (landmarks: Landmark[] | null, video: HTMLVideoElement) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = video.videoWidth || canvas.width;
      const h = video.videoHeight || canvas.height;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      ctx.clearRect(0, 0, w, h);
      if (!landmarks) return;

      ctx.lineWidth = Math.max(2, w / 220);
      ctx.strokeStyle = 'rgba(182, 243, 107, 0.85)';
      ctx.fillStyle = 'rgba(255, 107, 53, 0.95)';

      for (const [a, b] of SKELETON) {
        const p1 = landmarks[a];
        const p2 = landmarks[b];
        if (!p1 || !p2) continue;
        if ((p1.visibility ?? 1) < cfg.minVisibility || (p2.visibility ?? 1) < cfg.minVisibility) continue;
        ctx.beginPath();
        ctx.moveTo(p1.x * w, p1.y * h);
        ctx.lineTo(p2.x * w, p2.y * h);
        ctx.stroke();
      }

      const radius = Math.max(3, w / 150);
      for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26]) {
        const p = landmarks[i];
        if (!p || (p.visibility ?? 1) < cfg.minVisibility) continue;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    [canvasRef, cfg.minVisibility],
  );

  const loop = useCallback(() => {
    if (!runningRef.current) return;
    rafRef.current = requestAnimationFrame(loop);

    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    const counter = counterRef.current;
    if (!video || !landmarker || !counter || video.readyState < 2) return;

    // MediaPipe requires strictly increasing timestamps; skipping a repeated
    // frame also saves a whole inference on phones where the camera lags rAF.
    if (video.currentTime === lastVideoTimeRef.current) return;
    lastVideoTimeRef.current = video.currentTime;

    const now = performance.now();
    let landmarks: Landmark[] | null = null;

    try {
      landmarks = firstPose(landmarker.detectForVideo(video, now));
    } catch (err) {
      console.warn('[showup] inference failed', err);
      return;
    }

    const metrics = landmarks ? computeMetrics(landmarks, cfg.minVisibility) : null;
    const update = counter.update(metrics, now);
    draw(landmarks, video);

    // FPS over a rolling second.
    frameCountRef.current += 1;
    if (!fpsWindowStart.current) fpsWindowStart.current = now;

    const repEvent = update.repCounted;
    const elapsed = now - lastPushRef.current;

    if (repEvent || update.rejected || elapsed > 250) {
      lastPushRef.current = now;
      const windowMs = now - fpsWindowStart.current;
      const fps = windowMs > 900 ? Math.round((frameCountRef.current * 1000) / windowMs) : undefined;
      if (fps !== undefined) {
        frameCountRef.current = 0;
        fpsWindowStart.current = now;
      }

      setUi((prev) => {
        const next: WorkoutUiState = {
          ...prev,
          reps: update.reps,
          state: update.state,
          coaching: update.coaching,
          formWarning: update.formWarning,
          depth: update.depth,
          lastRejection: update.rejected ?? (repEvent ? null : prev.lastRejection),
          fps: fps ?? prev.fps,
        };
        return next;
      });

      if (repEvent) {
        onRepRef.current?.(update.reps);
        if ('vibrate' in navigator) navigator.vibrate?.(35);
      }
    }
  }, [cfg.minVisibility, draw, videoRef]);

  const start = useCallback(
    async (seedReps = 0) => {
      setUi((s) => ({ ...s, modelStatus: 'loading', modelError: null }));
      try {
        const landmarker = await loadPoseLandmarker();
        landmarkerRef.current = landmarker;

        const counter = new PushupCounter(cfg);
        counter.seed(seedReps);
        counterRef.current = counter;

        runningRef.current = true;
        pausedRef.current = false;
        lastVideoTimeRef.current = -1;
        frameCountRef.current = 0;
        fpsWindowStart.current = 0;

        setUi((s) => ({
          ...s,
          modelStatus: 'ready',
          delegate: getDelegate(),
          reps: seedReps,
          state: 'idle',
        }));
        rafRef.current = requestAnimationFrame(loop);
      } catch (err) {
        setUi((s) => ({
          ...s,
          modelStatus: 'error',
          modelError:
            err instanceof Error
              ? err.message
              : 'Could not load the pose model. Check your connection and try again.',
        }));
      }
    },
    [cfg, loop],
  );

  const pause = useCallback(() => {
    pausedRef.current = true;
    runningRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const resume = useCallback(() => {
    if (!counterRef.current || !landmarkerRef.current) return;
    pausedRef.current = false;
    runningRef.current = true;
    lastVideoTimeRef.current = -1;
    rafRef.current = requestAnimationFrame(loop);
  }, [loop]);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = undefined;
  }, []);

  /** Manual correction when the counter miscounts — always allowed. */
  const adjustReps = useCallback((delta: number) => {
    const counter = counterRef.current;
    if (!counter) {
      setUi((s) => ({ ...s, reps: Math.max(0, s.reps + delta) }));
      return;
    }
    counter.seed(Math.max(0, counter.reps + delta));
    setUi((s) => ({ ...s, reps: counter.reps }));
  }, []);

  useEffect(() => stop, [stop]);

  // A backgrounded tab gets no frames anyway; stopping avoids a timestamp jump
  // that MediaPipe rejects on return.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && runningRef.current) pause();
      else if (document.visibilityState === 'visible' && pausedRef.current) resume();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [pause, resume]);

  return { ui, start, pause, resume, stop, adjustReps, isPaused: () => pausedRef.current };
}
