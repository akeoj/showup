/**
 * Every tunable number for push-up detection lives here. Nothing else in the
 * app hard-codes a threshold, so calibrating against real footage means
 * editing one file (or overriding at runtime from a remote config later).
 *
 * Angles are degrees; durations are milliseconds.
 */
/** Which joint angle drives the rep, and how the body should be oriented. */
export type RepAngle = 'elbow' | 'knee' | 'hip';
export type Orientation = 'horizontal' | 'upright' | 'any';

export interface PushupConfig {
  /** The angle whose cycle counts as a repetition. */
  repAngle: RepAngle;
  /**
   * Expected body orientation. Checked when calibrating, and abandoned if it
   * stays wrong for a sustained stretch mid-set — but not frame by frame,
   * because a sit-up's torso goes from flat to upright and back on every
   * single rep.
   */
  orientation: Orientation;
  /** Whether a straight body is required (a plank position, for push-ups). */
  requireStraightBody: boolean;
  /** How long orientation must stay wrong mid-set before counting stops. */
  sustainedInvalidMs: number;
  /** Minimum landmark visibility for the joints we rely on. */
  minVisibility: number;
  /** Fraction of required landmarks that must clear minVisibility. */
  minLandmarkCoverage: number;

  /** Elbow angle at the top of a rep — arms considered extended above this. */
  upAngle: number;
  /** Elbow angle at the bottom — a rep only counts if it goes below this. */
  downAngle: number;
  /** Total elbow travel required within a rep, to reject shallow bobbing. */
  minRangeOfMotion: number;

  /** A rep faster than this is not a push-up; it is the phone being shaken. */
  minRepDurationMs: number;
  /** A "rep" slower than this is someone resting mid-position, not repping. */
  maxRepDurationMs: number;
  /** Dead time after a counted rep before another can start. */
  cooldownMs: number;

  /**
   * Side-on framing: torso must be within this many degrees of horizontal.
   * Only one of this and maxTorsoForeshortening has to pass — see below.
   */
  maxTorsoTiltFromHorizontal: number;
  /**
   * Front-on framing: torso length ÷ shoulder width in the image.
   *
   * Facing the camera foreshortens the torso towards ~0.5, while standing
   * upright sits nearer 1.5–2.5. Accepting either a horizontal torso OR a
   * strongly foreshortened one is what lets the phone sit in front of the
   * user instead of demanding a clear metre to their side — while still
   * rejecting someone stood up flapping their arms.
   */
  maxTorsoForeshortening: number;
  /** Hip angle (shoulder-hip-knee); a sagging or piked body is rejected. */
  minBodyStraightness: number;
  /** How far the body may deviate before we warn but still count. */
  bodyStraightnessWarnAt: number;

  /** Continuous ms of a valid position required before counting starts. */
  calibrationHoldMs: number;
  /** Losing the pose for longer than this drops back to calibration. */
  poseLostGraceMs: number;

  /** EMA factor for angle smoothing: higher = more responsive, more jitter. */
  smoothingAlpha: number;
  /** Frames of median filtering applied before the EMA, to kill spikes. */
  medianWindow: number;
}

export const DEFAULT_PUSHUP_CONFIG: PushupConfig = {
  repAngle: 'elbow',
  orientation: 'horizontal',
  requireStraightBody: true,
  sustainedInvalidMs: 3000,

  minVisibility: 0.5,
  minLandmarkCoverage: 0.7,

  upAngle: 150,
  downAngle: 100,
  minRangeOfMotion: 45,

  minRepDurationMs: 550,
  maxRepDurationMs: 12_000,
  cooldownMs: 250,

  maxTorsoTiltFromHorizontal: 55,
  maxTorsoForeshortening: 1.15,
  minBodyStraightness: 130,
  bodyStraightnessWarnAt: 150,

  calibrationHoldMs: 900,
  poseLostGraceMs: 1_200,

  smoothingAlpha: 0.45,
  medianWindow: 3,
};

/**
 * Slightly forgiving preset. Worth exposing to the user later as
 * "counting too strict?" rather than silently guessing per device.
 */
export const LENIENT_PUSHUP_CONFIG: PushupConfig = {
  ...DEFAULT_PUSHUP_CONFIG,
  upAngle: 140,
  downAngle: 110,
  minRangeOfMotion: 35,
  minVisibility: 0.4,
  maxTorsoTiltFromHorizontal: 70,
  maxTorsoForeshortening: 1.35,
  minBodyStraightness: 115,
};


/**
 * The other two exercises, as thresholds rather than as new code.
 *
 * The state machine was never really a push-up counter — it watches one angle
 * cross two thresholds while the body is in a plausible position. Squats and
 * sit-ups are the same machine pointed at a different joint, which is why they
 * inherit the framing checks, the smoothing, the rejection rules and the
 * partial-rep handling for free.
 */
export const SQUAT_CONFIG: PushupConfig = {
  ...DEFAULT_PUSHUP_CONFIG,
  repAngle: 'knee',
  // You are meant to be standing for this one, so the push-up orientation
  // check is not merely relaxed — it is inverted.
  orientation: 'upright',
  requireStraightBody: false,
  upAngle: 160,
  downAngle: 100,
  minRangeOfMotion: 50,
  minRepDurationMs: 700,
};

export const SITUP_CONFIG: PushupConfig = {
  ...DEFAULT_PUSHUP_CONFIG,
  repAngle: 'hip',
  // A sit-up's torso is flat at the bottom and vertical at the top, so no
  // fixed orientation describes it. Framing still has to be right.
  orientation: 'any',
  requireStraightBody: false,
  // Lying flat with knees bent reads around 150; sitting up around 60. The top
  // threshold needs headroom below 150 or the smoother never sees the return.
  upAngle: 130,
  downAngle: 80,
  minRangeOfMotion: 40,
  minRepDurationMs: 600,
};

export const EXERCISE_CONFIGS: Record<string, PushupConfig> = {
  pushups: DEFAULT_PUSHUP_CONFIG,
  squats: SQUAT_CONFIG,
  situps: SITUP_CONFIG,
};

export function configForExercise(id: string, lenient = false): PushupConfig {
  const base = EXERCISE_CONFIGS[id] ?? DEFAULT_PUSHUP_CONFIG;
  if (!lenient) return base;
  return {
    ...base,
    upAngle: base.upAngle - 10,
    downAngle: base.downAngle + 10,
    minRangeOfMotion: Math.max(20, base.minRangeOfMotion - 10),
    minVisibility: 0.4,
    maxTorsoTiltFromHorizontal: base.maxTorsoTiltFromHorizontal + 15,
    maxTorsoForeshortening: base.maxTorsoForeshortening + 0.2,
    minBodyStraightness: base.minBodyStraightness - 15,
  };
}
