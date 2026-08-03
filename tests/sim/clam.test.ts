import { describe, expect, it } from 'vitest';
import { Slingshot } from '../../src/sim/aim';
import { SIM } from '../../src/sim/config';
import { predictShot } from '../../src/sim/trajectory';
import { World } from '../../src/sim/world';
import type { SimEvent } from '../../src/sim/types';

/**
 * The clam (the pack's oyster rig) is the level's second goal type. Two rules
 * carry it:
 *   1. it is ALWAYS solid — open or shut it bounces ducks, because the rig is
 *      the game's bumper;
 *   2. it cracks open exactly once, on a hard enough duck hit (approach speed
 *      over CLAM_HIT_SPEED) or on any blast reaching within BLAST_R.
 *
 * Distances here are written against the contact radius DUCK_R + CLAM_R = 102
 * rather than literals, so a config retune moves the tests with it.
 */
const TOUCH = SIM.DUCK_R + SIM.CLAM_R;
const CLAM = { x: 360, y: 700 };
/** far enough left of the clam to build up speed, clear of the tub wall (x >= 92) */
const LANE_X = 150;

const steps = (w: World, n: number): void => {
  for (let i = 0; i < n; i++) w.step(SIM.DT);
};
/**
 * Step until the named event fires, then stop — the duck's post-bounce state has
 * to be read on the contact tick. Drag kills a slow rebound in ~10 ticks and a
 * fast one is back off the far wall inside 20, so "run 30 ticks then look" reads
 * the wrong moment entirely.
 */
const stepUntil = (w: World, type: SimEvent['type'], maxTicks = 240): number => {
  for (let i = 0; i < maxTicks; i++) {
    w.step(SIM.DT);
    if (w.events.some((e) => e.type === type)) return i;
  }
  return -1;
};
const only = (evs: SimEvent[], type: SimEvent['type']): SimEvent[] =>
  evs.filter((e) => e.type === type);

describe('clam — a solid bumper that cracks under a hard hit', () => {
  it('a shut clam bounces a slow duck back and stays shut', () => {
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    // parked 8px outside contact so the approach speed at impact is still the
    // one we set — comfortably under CLAM_HIT_SPEED, comfortably over STOP_SPEED
    const d = w.spawnDuck('red', CLAM.x - TOUCH - 8, CLAM.y);
    d.vx = 100;
    expect(SIM.CLAM_HIT_SPEED).toBeGreaterThan(100);
    w.events.length = 0;

    expect(stepUntil(w, 'bumperHit', 30)).toBeGreaterThanOrEqual(0);

    expect(c.open).toBe(false);
    expect(only(w.events, 'clamOpened')).toHaveLength(0);
    expect(only(w.events, 'pearlReleased')).toHaveLength(0);
    // it really did make contact, and it really did come back
    expect(only(w.events, 'bumperHit').length).toBeGreaterThan(0);
    expect(d.vx).toBeLessThan(0);
    expect(Math.hypot(d.x - c.x, d.y - c.y)).toBeGreaterThanOrEqual(TOUCH - 1e-6);
  });

  it('a fast duck cracks it open exactly once, spilling one pearl', () => {
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    const d = w.spawnDuck('red', LANE_X, CLAM.y);
    w.launch(d.id, SIM.LAUNCH_SPEED, 0);
    w.events.length = 0;

    // long enough for the shot to hit, rebound off the far wall and come back
    // for a second and third contact — still one open, one pearl
    steps(w, 240);

    expect(c.open).toBe(true);
    const opened = only(w.events, 'clamOpened');
    expect(opened).toHaveLength(1);
    expect(opened[0]).toEqual({ type: 'clamOpened', id: c.id, x: c.x, y: c.y });
    expect(only(w.events, 'pearlReleased')).toEqual([
      { type: 'pearlReleased', id: c.id, x: c.x, y: c.y },
    ]);
  });

  it('the crack threshold is the APPROACH speed, not the raw speed', () => {
    // A duck sliding past the clam's face at 900 px/s — seven times the crack
    // threshold — but grazing it: the lane is half a pixel inside contact range,
    // so the deepest possible normal component is ~68 px/s however the substeps
    // land. It bounces, it does not crack.
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    const d = w.spawnDuck('red', LANE_X, CLAM.y - (TOUCH - 0.5));
    d.vx = 900;
    w.events.length = 0;

    expect(stepUntil(w, 'bumperHit', 40)).toBeGreaterThanOrEqual(0);

    expect(Math.hypot(d.vx, d.vy)).toBeGreaterThan(SIM.CLAM_HIT_SPEED * 3);
    expect(c.open).toBe(false);
  });

  it('a blast inside BLAST_R opens it', () => {
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    const d = w.spawnDuck('red', CLAM.x, CLAM.y + SIM.BLAST_R - 5);
    w.events.length = 0;
    w.popDuck(d); // pops where it stands and detonates

    expect(c.open).toBe(true);
    expect(only(w.events, 'clamOpened')).toHaveLength(1);
    expect(only(w.events, 'pearlReleased')).toHaveLength(1);
  });

  it('a blast outside BLAST_R leaves it shut', () => {
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    const d = w.spawnDuck('red', CLAM.x, CLAM.y + SIM.BLAST_R + 5);
    w.events.length = 0;
    w.popDuck(d);

    expect(c.open).toBe(false);
    expect(only(w.events, 'clamOpened')).toHaveLength(0);
  });

  it('reach is pure centre distance, with no body-radius padding', () => {
    // exactly on the rim opens (<=), one pixel past does not
    const on = new World(1);
    const cOn = on.spawnClam(CLAM.x, CLAM.y);
    on.popDuck(on.spawnDuck('red', CLAM.x, CLAM.y + SIM.BLAST_R));
    expect(cOn.open).toBe(true);

    const off = new World(1);
    const cOff = off.spawnClam(CLAM.x, CLAM.y);
    off.popDuck(off.spawnDuck('red', CLAM.x, CLAM.y + SIM.BLAST_R + 1));
    expect(cOff.open).toBe(false);
  });

  it('an already-open clam never re-emits, however it is hit again', () => {
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    w.openClam(c);
    expect(only(w.events, 'clamOpened')).toHaveLength(1);
    w.events.length = 0;

    w.openClam(c);                                  // direct re-open
    w.popDuck(w.spawnDuck('green', CLAM.x, CLAM.y + 60)); // blast on top of it
    const d = w.spawnDuck('red', LANE_X, CLAM.y);
    w.launch(d.id, SIM.LAUNCH_SPEED, 0);            // and a full-speed slam
    steps(w, 240);

    expect(c.open).toBe(true);
    expect(only(w.events, 'clamOpened')).toHaveLength(0);
    expect(only(w.events, 'pearlReleased')).toHaveLength(0);
  });

  it('an open clam is still solid — it keeps bouncing ducks', () => {
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    w.openClam(c);
    const d = w.spawnDuck('red', LANE_X, CLAM.y);
    w.launch(d.id, SIM.LAUNCH_SPEED, 0);
    w.events.length = 0;

    expect(stepUntil(w, 'bumperHit', 60)).toBeGreaterThanOrEqual(0);

    expect(only(w.events, 'bumperHit').length).toBeGreaterThan(0);
    expect(d.vx).toBeLessThan(0);                  // came back
    expect(d.x).toBeLessThan(c.x - SIM.DUCK_R);    // did not tunnel through
    expect(Math.hypot(d.x - c.x, d.y - c.y)).toBeGreaterThanOrEqual(TOUCH - 1e-6);
  });

  it('a clam never blocks a duck out of the world: separation is exact', () => {
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    // start it overlapping and let the solver push it out
    const d = w.spawnDuck('yellow', CLAM.x + 10, CLAM.y + 10);
    steps(w, 5);
    expect(Math.hypot(d.x - c.x, d.y - c.y)).toBeCloseTo(TOUCH, 6);
  });

  it('the aim guide treats a clam as a blocker and the release is refused', () => {
    const w = new World(1);
    const shooter = w.spawnDuck('red', 150, 700);
    const clam = w.spawnClam(360, 700);
    const target = w.spawnDuck('yellow', 620, 700); // squarely behind the clam

    const pv = predictShot(w, shooter, { x: 1, y: 0 });
    expect(pv.hitKind).toBe('clam');
    expect(pv.hitId).toBe(clam.id);
    expect(pv.hitId).not.toBe(target.id);
    expect(pv.deflect).toBeNull();          // only a duck hit has a deflection
    expect(pv.points).toHaveLength(2);      // stopped on the clam, no bounce leg

    const sling = new Slingshot(w);
    sling.assist = 0;                       // aim exactly where we point it
    expect(sling.begin(shooter.x, shooter.y)).toBe(true);
    sling.move(shooter.x - 150, shooter.y); // pull back left => fire right
    expect(sling.preview()?.hitKind).toBe('clam');
    w.events.length = 0;
    expect(sling.end()).toBe(false);
    expect(only(w.events, 'duckLaunched')).toHaveLength(0);
    expect(shooter.live).toBe(false);
    expect(sling.aiming).toBe(false);        // the grab let go, as on a red X
  });

  it('an OPEN clam blocks the guide too — it is a bumper for good', () => {
    const w = new World(1);
    const shooter = w.spawnDuck('red', 150, 700);
    const clam = w.spawnClam(360, 700);
    w.openClam(clam);
    w.spawnDuck('yellow', 620, 700);

    const pv = predictShot(w, shooter, { x: 1, y: 0 });
    expect(pv.hitKind).toBe('clam');
    expect(pv.hitId).toBe(clam.id);
  });

  it('a clear lane past a clam still locks the duck behind it', () => {
    const w = new World(1);
    const shooter = w.spawnDuck('red', 150, 700);
    w.spawnClam(360, 700);
    // the target sits off the clam's lane; aim straight at it and the guide is happy
    const target = w.spawnDuck('yellow', 620, 350);
    const dx = target.x - shooter.x, dy = target.y - shooter.y;
    const len = Math.hypot(dx, dy);
    const pv = predictShot(w, shooter, { x: dx / len, y: dy / len });

    expect(pv.hitKind).toBe('duck');
    expect(pv.hitId).toBe(target.id);
  });

  it('spawnClam announces itself, shut, with the requested skin', () => {
    const w = new World(1);
    const c = w.spawnClam(200, 400, 'gold');
    expect(c).toMatchObject({ kind: 'clam', x: 200, y: 400, skin: 'gold', open: false });
    expect(only(w.events, 'clamSpawned')).toEqual([{ type: 'clamSpawned', clam: c }]);
    expect(w.spawnClam(300, 400).skin).toBe('normal'); // default
    expect(w.clams).toHaveLength(2);
  });
});
