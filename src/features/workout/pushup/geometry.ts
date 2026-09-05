export interface Landmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

/** MediaPipe Pose landmark indices we care about. */
export const LM = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

export const REQUIRED_LANDMARKS = [
  LM.LEFT_SHOULDER,
  LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW,
  LM.RIGHT_ELBOW,
  LM.LEFT_WRIST,
  LM.RIGHT_WRIST,
  LM.LEFT_HIP,
  LM.RIGHT_HIP,
];

/** Interior angle ABC in degrees, 0–180, in the image plane. */
export function angleDeg(a: Landmark, b: Landmark, c: Landmark): number {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;

  const dot = abx * cbx + aby * cby;
  const magAb = Math.hypot(abx, aby);
  const magCb = Math.hypot(cbx, cby);
  if (magAb === 0 || magCb === 0) return 180;

  const cos = Math.min(1, Math.max(-1, dot / (magAb * magCb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * The same angle in three dimensions.
 *
 * This is what makes a front-on camera workable. A 2D elbow angle is measured
 * on a flattened projection, so pointing your arm towards the lens shortens it
 * and the angle reads far straighter than it is. World landmarks are metric 3D
 * coordinates, so the angle is the real one whichever way the person faces.
 */
export function angleDeg3D(a: Landmark, b: Landmark, c: Landmark): number {
  const ab = { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) };
  const cb = { x: c.x - b.x, y: c.y - b.y, z: (c.z ?? 0) - (b.z ?? 0) };

  const dot = ab.x * cb.x + ab.y * cb.y + ab.z * cb.z;
  const magAb = Math.hypot(ab.x, ab.y, ab.z);
  const magCb = Math.hypot(cb.x, cb.y, cb.z);
  if (magAb === 0 || magCb === 0) return 180;

  const cos = Math.min(1, Math.max(-1, dot / (magAb * magCb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Angle of the segment AB against the horizontal, 0–90. */
export function tiltFromHorizontal(a: Landmark, b: Landmark): number {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx === 0 && dy === 0) return 0;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

export function visible(lm: Landmark | undefined, min: number): boolean {
  return !!lm && (lm.visibility ?? 1) >= min;
}

export type CameraView = 'side' | 'facing' | 'upright';

export interface PoseMetrics {
  /** Elbow angle, from 3D world landmarks when available. */
  elbowAngle: number;
  /** Shoulder–hip–knee angle: 180 is a plank, less is sagging or piked. */
  bodyStraightness: number;
  /** Torso deviation from horizontal in the image, in degrees. */
  torsoTilt: number;
  /**
   * Torso length ÷ shoulder width, in the image.
   *
   * The tell for a front-on camera: pointing your body at the lens
   * foreshortens the torso, so this collapses towards 0.5, while someone
   * standing upright sits nearer 1.5–2.5. It is what separates "in a plank,
   * facing me" from "standing up bending their arms".
   */
  torsoRatio: number;
  /** How the person is oriented relative to the camera. */
  view: CameraView;
  /** Share of required landmarks that met the visibility floor. */
  coverage: number;
  /** Mean visibility of the joints actually used. */
  confidence: number;
  /** False when the model returned no visibility scores at all (see below). */
  hasVisibilityData: boolean;
  /** True when 3D world landmarks were available for the joint angles. */
  usedWorldLandmarks: boolean;
}

/**
 * Some MediaPipe builds return landmarks with `visibility` absent or zero for
 * every point. Taking that at face value means every landmark reads as
 * invisible, coverage is 0, and the counter sits at zero for ever without
 * saying why. If no landmark in the frame carries a real score, the visibility
 * gate is meaningless and gets switched off rather than failing closed.
 */
function visibilityIsReported(landmarks: Landmark[]): boolean {
  return landmarks.some((l) => typeof l?.visibility === 'number' && l.visibility > 0);
}

const midpoint = (a: Landmark, b: Landmark): Landmark => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
});

/**
 * Reduce a frame of landmarks to the handful of numbers the state machine
 * needs. Both sides are averaged when visible so the participant can face
 * either way; a single visible side is enough.
 *
 * `world` is MediaPipe's metric 3D output for the same frame. When present it
 * drives the joint angles, which is what lets the camera sit in front of the
 * user rather than only side-on.
 */
export function computeMetrics(
  landmarks: Landmark[],
  requestedMinVisibility: number,
  world?: Landmark[] | null,
): PoseMetrics | null {
  if (!landmarks || landmarks.length < 29) return null;

  const hasVisibilityData = visibilityIsReported(landmarks);
  const minVisibility = hasVisibilityData ? requestedMinVisibility : 0;

  const seen = REQUIRED_LANDMARKS.filter((i) => visible(landmarks[i], minVisibility));
  const coverage = seen.length / REQUIRED_LANDMARKS.length;

  const useWorld = !!world && world.length >= 29;

  const elbowAngles: number[] = [];
  const straightness: number[] = [];
  const tilts: number[] = [];
  const confidences: number[] = [];

  const sides = [
    {
      shoulder: LM.LEFT_SHOULDER,
      elbow: LM.LEFT_ELBOW,
      wrist: LM.LEFT_WRIST,
      hip: LM.LEFT_HIP,
      knee: LM.LEFT_KNEE,
    },
    {
      shoulder: LM.RIGHT_SHOULDER,
      elbow: LM.RIGHT_ELBOW,
      wrist: LM.RIGHT_WRIST,
      hip: LM.RIGHT_HIP,
      knee: LM.RIGHT_KNEE,
    },
  ];

  for (const s of sides) {
    const shoulder = landmarks[s.shoulder];
    const elbow = landmarks[s.elbow];
    const wrist = landmarks[s.wrist];
    const hip = landmarks[s.hip];
    const knee = landmarks[s.knee];

    const armVisible =
      visible(shoulder, minVisibility) &&
      visible(elbow, minVisibility) &&
      visible(wrist, minVisibility);

    if (armVisible) {
      elbowAngles.push(
        useWorld
          ? angleDeg3D(world![s.shoulder], world![s.elbow], world![s.wrist])
          : angleDeg(shoulder, elbow, wrist),
      );
      confidences.push(
        ((shoulder.visibility ?? 1) + (elbow.visibility ?? 1) + (wrist.visibility ?? 1)) / 3,
      );
    }

    if (visible(shoulder, minVisibility) && visible(hip, minVisibility)) {
      tilts.push(tiltFromHorizontal(shoulder, hip));
      if (visible(knee, minVisibility)) {
        straightness.push(
          useWorld
            ? angleDeg3D(world![s.shoulder], world![s.hip], world![s.knee])
            : angleDeg(shoulder, hip, knee),
        );
      }
    }
  }

  if (elbowAngles.length === 0) return null;

  const mean = (xs: number[], fallback: number) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback;

  // Torso foreshortening, measured in the image plane.
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const lh = landmarks[LM.LEFT_HIP];
  const rh = landmarks[LM.RIGHT_HIP];

  let torsoRatio = 2;
  if (ls && rs && lh && rh) {
    const shoulderWidth = Math.hypot(ls.x - rs.x, ls.y - rs.y);
    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const torsoLength = Math.hypot(shoulderMid.x - hipMid.x, shoulderMid.y - hipMid.y);
    torsoRatio = shoulderWidth > 1e-4 ? torsoLength / shoulderWidth : 2;
  }

  const torsoTilt = mean(tilts, 0);

  // Side-on: the torso lies across the frame. Facing: the torso is pointed at
  // the lens and collapses. Anything else is someone upright.
  const view: CameraView = torsoTilt <= 55 ? 'side' : torsoRatio <= 1.15 ? 'facing' : 'upright';

  return {
    elbowAngle: mean(elbowAngles, 180),
    // With knees out of frame we cannot judge straightness; assume a plank
    // rather than blocking the user for a framing choice we recommended.
    bodyStraightness: mean(straightness, 180),
    torsoTilt,
    torsoRatio,
    view,
    coverage,
    confidence: mean(confidences, 0),
    hasVisibilityData,
    usedWorldLandmarks: useWorld,
  };
}

/** Median-of-N then exponential moving average. Cheap, and enough. */
export class AngleSmoother {
  private window: number[] = [];
  private ema: number | null = null;

  constructor(
    private readonly windowSize: number,
    private readonly alpha: number,
  ) {}

  push(value: number): number {
    this.window.push(value);
    if (this.window.length > this.windowSize) this.window.shift();

    const sorted = [...this.window].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    this.ema = this.ema === null ? median : this.alpha * median + (1 - this.alpha) * this.ema;
    return this.ema;
  }

  reset(): void {
    this.window = [];
    this.ema = null;
  }
}
