import { DEFAULT_PUSHUP_CONFIG, type PushupConfig } from './config';
import { AngleSmoother, type PoseMetrics } from './geometry';

export type CounterState =
  | 'idle' // no usable pose yet
  | 'calibrating' // pose found, waiting for a steady valid position
  | 'up' // arms extended, ready to descend
  | 'down'; // below the depth threshold, mid-rep

export type RejectReason =
  | 'too_fast'
  | 'too_slow'
  | 'too_shallow'
  | 'pose_lost'
  | 'cooldown';

export interface CounterUpdate {
  state: CounterState;
  reps: number;
  /** True only on the exact frame a rep was accepted. */
  repCounted: boolean;
  /** Set on the frame a candidate rep was thrown out, for the "not counted" hint. */
  rejected: RejectReason | null;
  /** 0–1 progress through the current descent, for the depth ring. */
  depth: number;
  /** Short instruction to show the user, or null when everything is fine. */
  coaching: string | null;
  /** Form problem worth flagging but not worth rejecting the rep over. */
  formWarning: string | null;
  smoothedElbowAngle: number;
  confidence: number;
  /** Why no rep is being counted right now — drives the diagnostics readout. */
  blockedBy: BlockReason | null;
}

export type BlockReason =
  | 'no-person'
  | 'not-enough-joints'
  | 'orientation'
  | 'body-not-straight'
  | 'calibrating'
  | 'none';

interface RepAttempt {
  startedAt: number;
  topAngle: number;
  minAngle: number;
  poseIntact: boolean;
}

/**
 * Pure, frame-driven push-up counter.
 *
 * Deliberately free of React, MediaPipe and the DOM: it takes metrics plus a
 * timestamp and returns a decision, which is what makes it testable against
 * synthetic sequences (see stateMachine.test.ts) instead of only against a
 * human doing push-ups in front of a laptop.
 */
export class PushupCounter {
  private readonly cfg: PushupConfig;
  private smoother: AngleSmoother;

  private state: CounterState = 'idle';
  private repsCount = 0;
  private attempt: RepAttempt | null = null;

  private validSince: number | null = null;
  private lastValidAt: number | null = null;
  private lastRepAt = 0;
  private lastAboveUpAt = 0;
  private topAngleSeen = 180;

  constructor(config: Partial<PushupConfig> = {}) {
    this.cfg = { ...DEFAULT_PUSHUP_CONFIG, ...config };
    this.smoother = new AngleSmoother(this.cfg.medianWindow, this.cfg.smoothingAlpha);
  }

  get reps(): number {
    return this.repsCount;
  }

  get currentState(): CounterState {
    return this.state;
  }

  /** Used when a participant resumes a session that already has reps on it. */
  seed(reps: number): void {
    this.repsCount = Math.max(0, Math.floor(reps));
  }

  reset(): void {
    this.smoother.reset();
    this.state = 'idle';
    this.repsCount = 0;
    this.attempt = null;
    this.validSince = null;
    this.lastValidAt = null;
    this.lastRepAt = 0;
    this.topAngleSeen = 180;
  }

  update(metrics: PoseMetrics | null, now: number): CounterUpdate {
    // --- No usable pose -----------------------------------------------------
    if (!metrics || metrics.coverage < this.cfg.minLandmarkCoverage) {
      if (this.attempt) this.attempt.poseIntact = false;

      const lostFor = this.lastValidAt === null ? Infinity : now - this.lastValidAt;
      let rejected: RejectReason | null = null;

      if (lostFor > this.cfg.poseLostGraceMs) {
        if (this.attempt) rejected = 'pose_lost';
        this.state = 'idle';
        this.attempt = null;
        this.validSince = null;
        this.smoother.reset();
      }

      return this.emit({
        repCounted: false,
        rejected,
        depth: 0,
        coaching:
          this.state === 'idle'
            ? 'Step back until your head, shoulders and hips are all in frame.'
            : 'Hold still — finding you again.',
        formWarning: null,
        angle: 180,
        confidence: metrics?.confidence ?? 0,
        blockedBy: metrics ? 'not-enough-joints' : 'no-person',
      });
    }

    this.lastValidAt = now;
    const angle = this.smoother.push(metrics.elbowAngle);

    // --- Body position ------------------------------------------------------
    // Two acceptable framings, not one: lying across the frame (phone to your
    // side) or pointed at the lens (phone in front of you, torso foreshortened).
    // Requiring only the first is what forced people to clear a metre of floor
    // beside them.
    const sideOn = metrics.torsoTilt <= this.cfg.maxTorsoTiltFromHorizontal;
    const facingCamera = metrics.foreshortening <= this.cfg.maxTorsoForeshortening;
    const orientationOk = sideOn || facingCamera;
    const straightOk = metrics.bodyStraightness >= this.cfg.minBodyStraightness;
    const positionValid = orientationOk && straightOk;

    const formWarning =
      metrics.bodyStraightness < this.cfg.bodyStraightnessWarnAt && straightOk
        ? 'Keep your hips in line with your shoulders.'
        : null;

    if (!positionValid) {
      if (this.attempt) this.attempt.poseIntact = false;
      this.validSince = null;
      if (this.state === 'up' || this.state === 'down') {
        this.state = 'calibrating';
        this.attempt = null;
      }
      return this.emit({
        repCounted: false,
        rejected: null,
        depth: 0,
        coaching: !orientationOk
          ? 'Get into a push-up position — the phone can be beside you or in front of you.'
          : 'Straighten your body — hips level with your shoulders.',
        formWarning: null,
        angle,
        confidence: metrics.confidence,
        blockedBy: !orientationOk ? 'orientation' : 'body-not-straight',
      });
    }

    // --- Calibration --------------------------------------------------------
    if (this.state === 'idle' || this.state === 'calibrating') {
      this.state = 'calibrating';
      if (this.validSince === null) this.validSince = now;

      const held = now - this.validSince;
      if (held >= this.cfg.calibrationHoldMs && angle >= this.cfg.upAngle) {
        this.state = 'up';
        this.lastAboveUpAt = now;
        this.topAngleSeen = angle;
        return this.emit({
          repCounted: false,
          rejected: null,
          depth: 0,
          coaching: null,
          formWarning,
          angle,
          confidence: metrics.confidence,
        });
      }

      return this.emit({
        repCounted: false,
        rejected: null,
        depth: 0,
        coaching:
          angle < this.cfg.upAngle
            ? 'Start at the top — arms straight.'
            : 'Hold it… getting ready.',
        formWarning,
        angle,
        confidence: metrics.confidence,
        blockedBy: 'calibrating',
      });
    }

    // --- Top position -------------------------------------------------------
    if (this.state === 'up') {
      if (angle >= this.cfg.upAngle) {
        this.lastAboveUpAt = now;
        this.topAngleSeen = Math.max(this.topAngleSeen, angle);
      }

      if (angle <= this.cfg.downAngle) {
        this.state = 'down';
        this.attempt = {
          // The rep began when the arms last left full extension, not when
          // they arrived at depth — otherwise a slow descent reads as fast.
          startedAt: this.lastAboveUpAt || now,
          topAngle: this.topAngleSeen,
          minAngle: angle,
          poseIntact: true,
        };
      }

      return this.emit({
        repCounted: false,
        rejected: null,
        depth: this.depthOf(angle),
        coaching: null,
        formWarning,
        angle,
        confidence: metrics.confidence,
      });
    }

    // --- Bottom position ----------------------------------------------------
    const attempt = this.attempt;
    if (!attempt) {
      this.state = 'calibrating';
      return this.emit({
        repCounted: false,
        rejected: null,
        depth: 0,
        coaching: null,
        formWarning,
        angle,
        confidence: metrics.confidence,
      });
    }

    attempt.minAngle = Math.min(attempt.minAngle, angle);

    if (angle < this.cfg.upAngle) {
      // Still down or on the way up; nothing to decide yet.
      if (now - attempt.startedAt > this.cfg.maxRepDurationMs) {
        this.state = 'calibrating';
        this.attempt = null;
        this.validSince = now;
        return this.emit({
          repCounted: false,
          rejected: 'too_slow',
          depth: this.depthOf(angle),
          coaching: 'Resting? Come back to the top to start counting again.',
          formWarning,
          angle,
          confidence: metrics.confidence,
        });
      }

      return this.emit({
        repCounted: false,
        rejected: null,
        depth: this.depthOf(angle),
        coaching: null,
        formWarning,
        angle,
        confidence: metrics.confidence,
      });
    }

    // Arms extended again: judge the completed cycle.
    const duration = now - attempt.startedAt;
    const range = attempt.topAngle - attempt.minAngle;

    this.state = 'up';
    this.lastAboveUpAt = now;
    this.topAngleSeen = angle;
    this.attempt = null;

    let rejected: RejectReason | null = null;
    if (!attempt.poseIntact) rejected = 'pose_lost';
    else if (now - this.lastRepAt < this.cfg.cooldownMs) rejected = 'cooldown';
    else if (duration < this.cfg.minRepDurationMs) rejected = 'too_fast';
    else if (duration > this.cfg.maxRepDurationMs) rejected = 'too_slow';
    else if (range < this.cfg.minRangeOfMotion || attempt.minAngle > this.cfg.downAngle) {
      rejected = 'too_shallow';
    }

    if (rejected) {
      return this.emit({
        repCounted: false,
        rejected,
        depth: 0,
        coaching: rejectionHint(rejected),
        formWarning,
        angle,
        confidence: metrics.confidence,
      });
    }

    this.repsCount += 1;
    this.lastRepAt = now;

    return this.emit({
      repCounted: true,
      rejected: null,
      depth: 0,
      coaching: null,
      formWarning,
      angle,
      confidence: metrics.confidence,
    });
  }

  /** 0 at full extension, 1 at the depth threshold. */
  private depthOf(angle: number): number {
    const span = this.cfg.upAngle - this.cfg.downAngle;
    if (span <= 0) return 0;
    return Math.min(1, Math.max(0, (this.cfg.upAngle - angle) / span));
  }

  private emit(args: {
    repCounted: boolean;
    rejected: RejectReason | null;
    depth: number;
    coaching: string | null;
    formWarning: string | null;
    angle: number;
    confidence: number;
    blockedBy?: BlockReason | null;
  }): CounterUpdate {
    return {
      state: this.state,
      reps: this.repsCount,
      repCounted: args.repCounted,
      rejected: args.rejected,
      depth: args.depth,
      coaching: args.coaching,
      formWarning: args.formWarning,
      smoothedElbowAngle: args.angle,
      confidence: args.confidence,
      blockedBy: args.blockedBy ?? null,
    };
  }
}

export function rejectionHint(reason: RejectReason): string {
  switch (reason) {
    case 'too_shallow':
      return 'Go lower — chest closer to the floor.';
    case 'too_fast':
      return 'Slow down a little, that one was too quick to count.';
    case 'too_slow':
      return 'Come back to the top to start the next rep.';
    case 'pose_lost':
      return 'Lost sight of you mid-rep — that one did not count.';
    case 'cooldown':
      return 'Steady — one rep at a time.';
  }
}
