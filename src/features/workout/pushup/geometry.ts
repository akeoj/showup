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

/** Interior angle ABC in degrees, 0–180. */
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

export interface PoseMetrics {
  /** Average elbow angle across whichever arms are visible. */
  elbowAngle: number;
  /** Shoulder–hip–knee angle: 180 is a plank, less is sagging or piked. */
  bodyStraightness: number;
  /** Torso deviation from horizontal, in degrees. */
  torsoTilt: number;
  /** Share of required landmarks that met the visibility floor. */
  coverage: number;
  /** Mean visibility of the joints actually used. */
  confidence: number;
}

/**
 * Reduce a frame of landmarks to the handful of numbers the state machine
 * needs. Both sides are averaged when visible so the participant can face
 * either way; a single visible side is enough.
 */
export function computeMetrics(landmarks: Landmark[], minVisibility: number): PoseMetrics | null {
  if (!landmarks || landmarks.length < 29) return null;

  const seen = REQUIRED_LANDMARKS.filter((i) => visible(landmarks[i], minVisibility));
  const coverage = seen.length / REQUIRED_LANDMARKS.length;

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

    if (visible(shoulder, minVisibility) && visible(elbow, minVisibility) && visible(wrist, minVisibility)) {
      elbowAngles.push(angleDeg(shoulder, elbow, wrist));
      confidences.push(
        ((shoulder.visibility ?? 1) + (elbow.visibility ?? 1) + (wrist.visibility ?? 1)) / 3,
      );
    }

    if (visible(shoulder, minVisibility) && visible(hip, minVisibility)) {
      tilts.push(tiltFromHorizontal(shoulder, hip));
      if (visible(knee, minVisibility)) {
        straightness.push(angleDeg(shoulder, hip, knee));
      }
    }
  }

  if (elbowAngles.length === 0) return null;

  const mean = (xs: number[], fallback: number) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback;

  return {
    elbowAngle: mean(elbowAngles, 180),
    // With knees out of frame we cannot judge straightness; assume a plank
    // rather than blocking the user for a framing choice we recommended.
    bodyStraightness: mean(straightness, 180),
    torsoTilt: mean(tilts, 0),
    coverage,
    confidence: mean(confidences, 0),
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
