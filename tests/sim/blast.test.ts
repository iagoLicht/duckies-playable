import { describe, expect, it } from 'vitest';
import { SIM } from '../../src/sim/config';
import { World } from '../../src/sim/world';
import type { SimEvent } from '../../src/sim/types';

interface Stamped { tick: number; e: SimEvent }

/** Step one tick at a time, stamping every event with the tick it fired on. */
const record = (w: World, ticks: number): Stamped[] => {
  const out: Stamped[] = [];
  w.events.length = 0;
  for (let tick = 0; tick < ticks; tick++) {
    w.step(SIM.DT);
    for (const e of w.events.splice(0, w.events.length)) out.push({ tick, e });
  }
  return out;
};

const firstTick = (log: Stamped[], type: SimEvent['type']): number =>
  log.find((s) => s.e.type === type)?.tick ?? -1;

/**
 * Run out every duck's spawn shield. These tests are about BLAST semantics on
 * an ordinary duck, and a freshly spawned one is deliberately not ordinary —
 * explosions in progress cannot touch it (SIM.SPAWN_SHIELD_TICKS; the shield
 * has its own suite in world.test.ts).
 */
const ripen = (w: World): void => {
  for (let i = 0; i < SIM.SPAWN_SHIELD_TICKS; i++) w.step(SIM.DT);
};

/**
 * The blast shove: every duck inside BLAST_R takes a subtle radial kick with
 * linear centre→edge falloff and is doomed regardless of colour — it blinks
 * from the moment it's caught, keeps its physics, and pops only after it has
 * fully settled AND stayed static for the whole confirmation hold (the long
 * fresh fuse it gets is only the failsafe for a duck that never stops moving).
 */
describe('blast knockback and settle-pops', () => {
  it('pushed → blinks while moving → settles → holds still → explodes', () => {
    const w = new World(1);
    const d = w.spawnDuck('purple', 360, 600);
    ripen(w);
    w.blast('green', 360, 700); // 100px below the duck — inside BLAST_R 135

    // pushed straight away from the blast, doomed, blinking — but NOT popped
    expect(d.vx).toBe(0);
    expect(d.vy).toBeLessThan(-SIM.BLAST_KNOCK_EDGE);
    expect(d.vy).toBeGreaterThan(-SIM.BLAST_KNOCK);
    expect(d.live).toBe(true);
    expect(d.matched).toBe(true);
    expect(d.popOnSettle).toBe(true);
    expect(d.popping).toBe(false);

    // still moving and still blinking mid-slide
    for (let t = 0; t < 10; t++) w.step(SIM.DT);
    expect(d.vy).toBeLessThan(0);
    expect(d.matched).toBe(true);
    expect(w.ducks).toContain(d);

    // never during movement; then a full stillness hold after it comes to rest
    // (the counter starts on the stop tick itself)
    const log = record(w, 400);
    const stopTick = firstTick(log, 'duckStopped');
    const popTick = firstTick(log, 'duckPopped');
    expect(stopTick).toBeGreaterThan(0);
    expect(popTick).toBe(stopTick + SIM.BLAST_SETTLE_CONFIRM_TICKS - 1);
    expect(w.ducks).toHaveLength(0);
    // the drift itself stays subtle — a nudge, not a launch
    const popped = log.find((s) => s.e.type === 'duckPopped')!.e as { x: number; y: number };
    const drift = Math.hypot(popped.x - 360, popped.y - 600);
    expect(drift).toBeGreaterThan(10);
    expect(drift).toBeLessThan(70);
  });

  it("the settled victim's own blast dooms the next duck — the chain walks on", () => {
    const w = new World(1);
    const first = w.spawnDuck('purple', 360, 600);
    // clear of the original blast AND of the victim's slide lane, but inside
    // blast range of where the victim comes to rest (~(360, 538))
    const second = w.spawnDuck('red', 460, 520);
    ripen(w);
    w.blast('green', 360, 700);
    expect(first.matched).toBe(true);
    expect(second.matched).toBe(false); // out of reach of the first blast

    const log = record(w, 800);
    const pops = log.filter((s) => s.e.type === 'duckPopped');
    expect(pops).toHaveLength(2);
    expect((pops[0]!.e as { id: number }).id).toBe(first.id);
    expect((pops[1]!.e as { id: number }).id).toBe(second.id);
    // each generation needs its own slide + full stillness hold — deliberately staged
    expect(pops[1]!.tick - pops[0]!.tick).toBeGreaterThan(SIM.BLAST_SETTLE_CONFIRM_TICKS);
    expect(w.ducks).toHaveLength(0);
  });

  it('never explodes a victim that is still moving, however long it takes', () => {
    const w = new World(1);
    // knocked into the bumper lane, so it is bounced around well past any fuse
    const d = w.spawnDuck('purple', 200, 950);
    ripen(w);
    w.blast('green', 320, 950);

    let poppedWhileMoving = false;
    let sawMotion = 0;
    for (let t = 0; t < 600; t++) {
      const moving = d.vx !== 0 || d.vy !== 0;
      if (moving) sawMotion++;
      w.events.length = 0;
      w.step(SIM.DT);
      // a pop this tick is only legal if the duck was already dead still
      if (w.events.some((e) => e.type === 'duckPopped') && moving) poppedWhileMoving = true;
    }
    expect(sawMotion).toBeGreaterThan(20); // it really did travel
    expect(poppedWhileMoving).toBe(false);
    // and it does eventually go off, once it has been idle long enough
    expect(w.ducks).toHaveLength(0);
    // the fuse ran far past zero without ever forcing the pop
    expect(SIM.BLAST_SETTLE_CONFIRM_TICKS).toBeLessThan(SIM.MATCH_FUSE_TICKS);
  });

  it('kicks harder near the centre than at the rim', () => {
    const w = new World(1);
    const near = w.spawnDuck('purple', 360, 620); // 80px from the blast
    const far = w.spawnDuck('red', 360, 830); // 130px from the blast
    ripen(w);
    w.blast('green', 360, 700);

    expect(near.vy).toBeLessThan(0); // pushed up
    expect(far.vy).toBeGreaterThan(0); // pushed down
    expect(Math.abs(near.vy)).toBeGreaterThan(Math.abs(far.vy));
  });

  it('a same-colour victim gets the identical treatment: fuse, shove, doom', () => {
    const w = new World(1);
    const d = w.spawnDuck('green', 360, 600);
    ripen(w);
    w.blast('green', 360, 700);

    expect(d.matched).toBe(true);
    expect(d.matchFuse).toBe(SIM.MATCH_FUSE_TICKS);
    expect(d.popOnSettle).toBe(true);
    expect(d.vy).toBeLessThan(0);
    expect(d.live).toBe(true);
  });

  it('leaves ducks outside the radius untouched', () => {
    const w = new World(1);
    const d = w.spawnDuck('purple', 360, 500); // 200px away
    ripen(w);
    w.blast('green', 360, 700);

    expect(d.vx).toBe(0);
    expect(d.vy).toBe(0);
    expect(d.live).toBe(false);
    expect(d.matched).toBe(false);
    expect(d.popOnSettle).toBe(false);
  });
});
