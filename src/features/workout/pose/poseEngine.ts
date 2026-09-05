import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import type { Landmark } from '../pushup/geometry';

const WASM_BASE =
  (import.meta.env.VITE_MEDIAPIPE_WASM_BASE as string | undefined) ??
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

/**
 * "lite" by default, on purpose. On a low-end Android the full model drops to
 * single-digit FPS, and a counter that misses reps is worse than a slightly
 * noisier one that keeps up.
 */
const MODEL_URL =
  (import.meta.env.VITE_POSE_MODEL_URL as string | undefined) ??
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

let landmarkerPromise: Promise<PoseLandmarker> | null = null;
let activeDelegate: 'GPU' | 'CPU' = 'GPU';

export function getDelegate(): 'GPU' | 'CPU' {
  return activeDelegate;
}

async function create(delegate: 'GPU' | 'CPU'): Promise<PoseLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  });
}

/**
 * Loads the model once per session. The wasm and .task file are cached by the
 * service worker (CacheFirst), so the second workout starts instantly and
 * works with no connection at all.
 */
export function loadPoseLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = create('GPU')
      .then((lm) => {
        activeDelegate = 'GPU';
        return lm;
      })
      .catch(async (err) => {
        console.warn('[showup] GPU delegate unavailable, falling back to CPU', err);
        activeDelegate = 'CPU';
        return create('CPU');
      })
      .catch((err) => {
        landmarkerPromise = null;
        throw err;
      });
  }
  return landmarkerPromise;
}

export function disposePoseLandmarker(): void {
  const p = landmarkerPromise;
  landmarkerPromise = null;
  void p?.then((lm) => lm.close()).catch(() => undefined);
}

export function firstPose(result: PoseLandmarkerResult | undefined): Landmark[] | null {
  const lm = result?.landmarks?.[0];
  return lm && lm.length ? (lm as Landmark[]) : null;
}

/**
 * Metric 3D landmarks for the same frame, origin at the hips.
 *
 * Joint angles taken from these are independent of where the camera is, which
 * is what makes a front-on phone work: a 2D elbow angle measured on a
 * projection reads far too straight when the arm points at the lens.
 */
export function firstWorldPose(result: PoseLandmarkerResult | undefined): Landmark[] | null {
  const lm = result?.worldLandmarks?.[0];
  return lm && lm.length ? (lm as unknown as Landmark[]) : null;
}

export { PoseLandmarker };
