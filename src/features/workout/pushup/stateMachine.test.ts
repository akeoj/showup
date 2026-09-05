import { describe, expect, it } from 'vitest';
import { PushupCounter } from './stateMachine';
import { DEFAULT_PUSHUP_CONFIG } from './config';
import type { PoseMetrics } from './geometry';

const cfg = DEFAULT_PUSHUP_CONFIG;

function metrics(elbowAngle: number, overrides: Partial<PoseMetrics> = {}): PoseMetrics {
  return {
    elbowAngle,
    bodyStraightness: 175,
    torsoTilt: 10,
    torsoRatio: 1.8,
    legRatio: 1.8,
    foreshortening: 1.8,
    view: 'side',
    coverage: 1,
    confidence: 0.9,
    hasVisibilityData: true,
    usedWorldLandmarks: true,
    ...overrides,
  };
}

/**
 * Phone in front of the user: the torso points at the lens, so it reads as
 * near-vertical in the image and collapses to well under a shoulder width.
 */
function facingMetrics(elbowAngle: number, overrides: Partial<PoseMetrics> = {}): PoseMetrics {
  return metrics(elbowAngle, {
    torsoTilt: 82,
    torsoRatio: 0.6,
    legRatio: 0.5,
    foreshortening: 0.5,
    view: 'facing',
    ...overrides,
  });
}

/** Feed the same angle for a stretch of time, returning the final update. */
function hold(counter: PushupCounter, angle: number, from: number, ms: number, stepMs = 33) {
  let t = from;
  let last = counter.update(metrics(angle), t);
  const rejections: (string | null)[] = [last.rejected];
  const end = from + ms;
  while (t < end) {
    t += stepMs;
    last = counter.update(metrics(angle), t);
    rejections.push(last.rejected);
  }
  return { t, last, rejections: rejections.filter(Boolean) as string[] };
}

/** Interpolate between two angles over a duration, as a real descent would. */
function sweep(counter: PushupCounter, a: number, b: number, from: number, ms: number, stepMs = 33) {
  let t = from;
  let last = counter.update(metrics(a), t);
  const rejections: (string | null)[] = [last.rejected];
  const steps = Math.max(1, Math.round(ms / stepMs));
  for (let i = 1; i <= steps; i++) {
    t = from + (ms * i) / steps;
    last = counter.update(metrics(a + ((b - a) * i) / steps), t);
    rejections.push(last.rejected);
  }
  return { t, last, rejections: rejections.filter(Boolean) as string[] };
}

function calibrate(counter: PushupCounter, start = 1000) {
  const { t } = hold(counter, 170, start, cfg.calibrationHoldMs + 200);
  expect(counter.currentState).toBe('up');
  return t;
}

/** One well-formed rep: down over 400ms, hold, up over 400ms. */
function doRep(counter: PushupCounter, from: number, downMs = 400, upMs = 400, bottom = 70) {
  let t = sweep(counter, 170, bottom, from, downMs).t;
  t = hold(counter, bottom, t, 100).t;
  const { t: end, last } = sweep(counter, bottom, 170, t, upMs);
  return { t: end, last };
}

describe('PushupCounter', () => {
  it('starts idle and needs a steady pose before counting', () => {
    const c = new PushupCounter();
    expect(c.currentState).toBe('idle');

    const first = c.update(metrics(170), 0);
    expect(first.state).toBe('calibrating');
    expect(first.reps).toBe(0);

    calibrate(c, 0);
  });

  it('counts a clean rep', () => {
    const c = new PushupCounter();
    const t = calibrate(c);
    const { last } = doRep(c, t);

    expect(last.repCounted).toBe(true);
    expect(c.reps).toBe(1);
    expect(last.state).toBe('up');
  });

  it('counts several reps in a row', () => {
    const c = new PushupCounter();
    let t = calibrate(c);
    for (let i = 0; i < 5; i++) {
      t = doRep(c, t).t + 300; // brief pause at the top between reps
      hold(c, 170, t, 200);
      t += 200;
    }
    expect(c.reps).toBe(5);
  });

  it('rejects a shallow rep that never reaches depth', () => {
    const c = new PushupCounter();
    const t = calibrate(c);
    // Bobbing between 170 and 130: below `upAngle` but never below `downAngle`.
    const { last } = doRep(c, t, 400, 400, 130);

    expect(c.reps).toBe(0);
    expect(last.repCounted).toBe(false);
  });

  it('rejects a rep performed impossibly fast', () => {
    const c = new PushupCounter();
    let t = calibrate(c);
    // 150ms down, 150ms up at 10ms per frame: enough samples for the smoother
    // to actually register the depth, but far under the minimum rep duration.
    t = sweep(c, 170, 65, t, 150, 10).t;
    const { last } = sweep(c, 65, 170, t, 150, 10);

    expect(c.reps).toBe(0);
    expect(last.rejected).toBe('too_fast');
  });

  it('ignores movement too fast for the smoother to even see', () => {
    const c = new PushupCounter();
    const t = calibrate(c);
    // A phone being shaken: two frames down, two frames up.
    doRep(c, t, 60, 60, 70);
    expect(c.reps).toBe(0);
  });

  it('counts with the phone in front of the user, not just side-on', () => {
    const c = new PushupCounter();
    // Calibrate using facing-camera geometry only.
    let t = 1000;
    for (let i = 0; i < 40; i++) {
      c.update(facingMetrics(170), t);
      t += 33;
    }
    expect(c.currentState).toBe('up');

    // One clean rep, all frames front-on.
    let tt = t;
    const sweepFacing = (a: number, b: number, ms: number, step = 33) => {
      const steps = Math.max(1, Math.round(ms / step));
      for (let i = 1; i <= steps; i++) {
        tt += ms / steps;
        c.update(facingMetrics(a + ((b - a) * i) / steps), tt);
      }
    };
    sweepFacing(170, 70, 400);
    for (let i = 0; i < 4; i++) {
      tt += 33;
      c.update(facingMetrics(70), tt);
    }
    sweepFacing(70, 170, 400);

    expect(c.reps).toBe(1);
  });

  it('counts front-on even when only the legs read as foreshortened', () => {
    // A phone propped at an angle can leave the torso projecting long while
    // the legs still collapse towards the lens. Judging on the torso alone
    // rejected this; the minimum of the two accepts it.
    const awkward = (a: number) =>
      metrics(a, { torsoTilt: 78, torsoRatio: 1.6, legRatio: 0.5, foreshortening: 0.5 });

    const c = new PushupCounter();
    let t = 1000;
    for (let i = 0; i < 40; i++) {
      c.update(awkward(170), t);
      t += 33;
    }
    expect(c.currentState).toBe('up');

    const sweepAwkward = (from: number, to: number, ms: number) => {
      const steps = Math.round(ms / 33);
      for (let i = 1; i <= steps; i++) {
        t += ms / steps;
        c.update(awkward(from + ((to - from) * i) / steps), t);
      }
    };
    sweepAwkward(170, 70, 400);
    for (let i = 0; i < 4; i++) {
      t += 33;
      c.update(awkward(70), t);
    }
    sweepAwkward(70, 170, 400);

    expect(c.reps).toBe(1);
  });

  it('still rejects someone standing up bending their arms', () => {
    const c = new PushupCounter();
    let t = 1000;
    // Upright: torso vertical in the image AND a full torso length, which is
    // what separates standing from a plank pointed at the camera.
    for (let i = 0; i < 40; i++) {
      c.update(metrics(170, { torsoTilt: 85, torsoRatio: 2.1, legRatio: 1.9, foreshortening: 1.9 }), t);
      t += 33;
    }
    for (let i = 0; i < 40; i++) {
      c.update(metrics(70, { torsoTilt: 85, torsoRatio: 2.1, legRatio: 1.9, foreshortening: 1.9 }), t);
      t += 33;
    }
    expect(c.reps).toBe(0);
  });

  it('does not count while the body is not in a push-up position', () => {
    const c = new PushupCounter();
    let t = 1000;

    // Standing: torso vertical AND full length, so neither framing applies.
    for (let i = 0; i < 40; i++) {
      c.update(metrics(170, { torsoTilt: 85, torsoRatio: 2.1, legRatio: 1.9, foreshortening: 1.9 }), t);
      t += 33;
    }
    // An invalid body position never even reaches calibration.
    expect(c.currentState).toBe('idle');

    // Bending the arms while standing must not produce a rep.
    for (let i = 0; i < 20; i++) {
      c.update(metrics(70, { torsoTilt: 85, torsoRatio: 2.1, legRatio: 1.9, foreshortening: 1.9 }), t);
      t += 33;
    }
    expect(c.reps).toBe(0);
  });

  it('rejects a rep where the pose was lost mid-way', () => {
    const c = new PushupCounter();
    let t = calibrate(c);

    t = sweep(c, 170, 70, t, 400).t;
    // Person leaves frame briefly at the bottom.
    c.update(null, t + 33);
    t += 66;
    const { last } = sweep(c, 70, 170, t, 400);

    expect(c.reps).toBe(0);
    expect(last.rejected).toBe('pose_lost');
  });

  it('abandons a rep that stalls at the bottom for too long', () => {
    const c = new PushupCounter();
    let t = calibrate(c);
    t = sweep(c, 170, 70, t, 400).t;
    const { rejections } = hold(c, 70, t, cfg.maxRepDurationMs + 1000, 100);

    expect(c.reps).toBe(0);
    expect(rejections).toContain('too_slow');
  });

  it('drops back to idle after the pose is gone past the grace period', () => {
    const c = new PushupCounter();
    let t = calibrate(c);
    for (let i = 0; i < 60; i++) {
      t += 50;
      c.update(null, t);
    }
    expect(c.currentState).toBe('idle');
  });

  it('keeps counting from a seeded value when resuming a session', () => {
    const c = new PushupCounter();
    c.seed(12);
    const t = calibrate(c);
    doRep(c, t);
    expect(c.reps).toBe(13);
  });

  it('reports depth between 0 and 1 during a descent', () => {
    const c = new PushupCounter();
    const t = calibrate(c);
    const mid = sweep(c, 170, 125, t, 300).last;
    expect(mid.depth).toBeGreaterThan(0);
    expect(mid.depth).toBeLessThanOrEqual(1);
  });
});
