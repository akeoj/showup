/**
 * Every tunable number for push-up detection lives here. Nothing else in the
 * app hard-codes a threshold, so calibrating against real footage means
 * editing one file (or overriding at runtime from a remote config later).
 *
 * Angles are degrees; durations are milliseconds.
 */
export interface PushupConfig {
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

  /** Torso must be within this many degrees of horizontal (side view). */
  maxTorsoTiltFromHorizontal: number;
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
  minVisibility: 0.5,
  minLandmarkCoverage: 0.7,

  upAngle: 150,
  downAngle: 100,
  minRangeOfMotion: 45,

  minRepDurationMs: 550,
  maxRepDurationMs: 12_000,
  cooldownMs: 250,

  maxTorsoTiltFromHorizontal: 55,
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
  minBodyStraightness: 115,
};
