import { describe, expect, it } from 'vitest';
import { SIM } from '../../src/sim/config';
import { World } from '../../src/sim/world';

/**
 * THE PLAYER'S SHOT LANDS AT FULL STRENGTH, WHATEVER THE ANGLE.
 *
 * A shot is aimed at a duck, so the duck it was aimed at should always be sent
 * away with the same force — the angle picks the DIRECTION and nothing else.
 * The plain equal-mass impulse cannot do that: it scales with the normal
 * component of the approach, so a shallow contact transfers almost nothing.
 * Measured over the campaign bot (1045 player shots), the target's departure
 * speed by impact obliquity:
 *
 *   graze   <0.35    p50   630
 *   oblique .35-.7   p50  1416
 *   solid   .7-.9    p50  2075
 *   centre   >0.9    p50  2549
 *
 * A graze left with a quarter of a centre hit. SIM.SHOT_STRIKE_SPEED is that
 * centre-hit median, so the shots that already felt right are unchanged and the
 * rest are lifted to meet them.
 *
 * ONLY the first duck each shot reaches. Everything downstream of that — the
 * carom, the knocked duck's own collisions, blasts, chains — keeps the ordinary
 * physics, which is what makes a chain read as a consequence rather than as a
 * second shot.
 */
const R = SIM.DUCK_R * 2;

/** Launch a duck at a target offset perpendicular to the shot line. */
const strike = (offsetY: number, launchVx = 1600): { speed: number; dir: number } | null => {
  const w = new World(1);
  const shooter = w.spawnDuck('red', 300, 700 - offsetY);
  const target = w.spawnDuck('green', 500, 700); // different colour: no fuse to muddy it
  w.launch(shooter.id, launchVx, 0);
  for (let i = 0; i < 90; i++) {
    w.step(SIM.DT);
    // drag runs at the TOP of the next step, so reading here is the exact
    // post-impact velocity
    if (target.vx !== 0 || target.vy !== 0) {
      return { speed: Math.hypot(target.vx, target.vy), dir: Math.atan2(target.vy, target.vx) };
    }
  }
  return null;
};

describe("a player shot's first duck", () => {
  it('leaves at SHOT_STRIKE_SPEED on a dead-centre hit', () => {
    const hit = strike(0);
    expect(hit).not.toBeNull();
    expect(hit!.speed).toBeCloseTo(SIM.SHOT_STRIKE_SPEED, 6);
    expect(hit!.dir).toBeCloseTo(0, 6); // straight down the shot line
  });

  it('leaves at the SAME speed however shallow the angle — only the direction moves', () => {
    const speeds: number[] = [];
    const dirs: number[] = [];
    for (let i = 0; i <= 18; i++) {
      const hit = strike((i / 18) * R * 0.985);
      if (!hit) continue;
      speeds.push(hit.speed);
      dirs.push(hit.dir);
    }
    expect(speeds.length).toBeGreaterThan(15); // the sweep has to connect
    for (const s of speeds) expect(s).toBeCloseTo(SIM.SHOT_STRIKE_SPEED, 6);
    // and it really was a sweep: a graze sends the duck well off the shot line
    expect(Math.max(...dirs) - Math.min(...dirs)).toBeGreaterThan(1); // > 57 degrees
  });

  it('is the only duck that shot sends at the fixed speed', () => {
    // a row, with the far duck a clear run downrange — close enough that the
    // struck duck reaches it, far enough that it does so on a LATER step, so
    // the two arrivals can be told apart
    const w = new World(1);
    const shooter = w.spawnDuck('red', 200, 700);
    const mid = w.spawnDuck('green', 420, 700);
    const far = w.spawnDuck('purple', 420 + 300, 700);
    w.launch(shooter.id, 1800, 0);

    const firstMove = new Map<number, number>();
    for (let i = 0; i < 200; i++) {
      w.step(SIM.DT);
      for (const d of [mid, far]) {
        if (!firstMove.has(d.id) && (d.vx !== 0 || d.vy !== 0)) {
          firstMove.set(d.id, Math.hypot(d.vx, d.vy));
        }
      }
    }
    expect(firstMove.get(mid.id)).toBeCloseTo(SIM.SHOT_STRIKE_SPEED, 6);
    // the far duck was struck by the MID duck, not by the shot — ordinary
    // physics, so it must not come out at the fixed speed
    expect(firstMove.has(far.id)).toBe(true);
    expect(Math.abs(firstMove.get(far.id)! - SIM.SHOT_STRIKE_SPEED)).toBeGreaterThan(1);
  });

  it('a duck merely KNOCKED into another gets ordinary physics, not a strike', () => {
    const w = new World(1);
    const knocked = w.spawnDuck('red', 300, 700);
    const target = w.spawnDuck('green', 500, 700);
    knocked.vx = 1600; // shoved, never launched — this is not a player shot
    for (let i = 0; i < 90; i++) {
      w.step(SIM.DT);
      if (target.vx !== 0 || target.vy !== 0) break;
    }
    expect(Math.hypot(target.vx, target.vy)).toBeGreaterThan(0);
    expect(Math.abs(Math.hypot(target.vx, target.vy) - SIM.SHOT_STRIKE_SPEED)).toBeGreaterThan(1);
  });

  it('a shot that comes to rest without reaching a duck spends its strike', () => {
    const w = new World(1);
    const shooter = w.spawnDuck('red', 300, 400);
    const target = w.spawnDuck('green', 300, 900);
    w.launch(shooter.id, 0, -1); // fired the other way, into nothing
    for (let i = 0; i < 240 && shooter.live; i++) w.step(SIM.DT);
    expect(shooter.live).toBe(false); // it settled without striking anything

    // now shove it into the target: a knock, not the player's shot
    shooter.vy = 1600;
    for (let i = 0; i < 120; i++) {
      w.step(SIM.DT);
      if (target.vx !== 0 || target.vy !== 0) break;
    }
    expect(Math.hypot(target.vx, target.vy)).toBeGreaterThan(0);
    expect(Math.abs(Math.hypot(target.vx, target.vy) - SIM.SHOT_STRIKE_SPEED)).toBeGreaterThan(1);
  });
});
