import { describe, expect, it } from 'vitest';
import { SIM } from '../../src/sim/config';
import { Director } from '../../src/sim/director';
import { predictShot } from '../../src/sim/trajectory';

/**
 * A shot only fires when the aim guide reaches another duck, so a board can be
 * fully stocked and still completely dead: statics between every pair of ducks
 * and no lane between them. Counting ducks cannot detect that — which is how a
 * walled level soft-locks with the player holding a full hand.
 */
const legalShotExists = (d: Director): boolean => {
  for (const duck of d.world.ducks) {
    if (duck.live || duck.popping || duck.matched) continue;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      if (predictShot(d.world, duck, { x: Math.cos(a), y: Math.sin(a) }).hitKind === 'duck') {
        return true;
      }
    }
  }
  return false;
};

describe('the board can never become unplayable', () => {
  // Explicit timeout: this sweeps 4 ducks x 48 directions through predictShot on
  // every one of 360 ticks, which is ~2s alone but tips past vitest's 5s default
  // under full-suite CPU contention. The clams' bumper fling made that worse
  // across the board — faster ducks drive the adaptive substepper toward its
  // 16-substep cap far more often, so every tick costs more collision work (the
  // whole suite went 47s -> 173s). The substeps are load-bearing, not waste:
  // they are what stops a duck leaving a clam at 2600px/s from tunnelling.
  it('rescues a stocked board that has no legal shot left', () => {
    const d = new Director(11, 0);
    d.start();

    // Quarter the tub with a solid cross of crates (centres 108 apart, closer
    // than the 106 of clearance a duck needs, so nothing threads it) and strand
    // one duck in each quadrant. The duck COUNT stays at the level's target
    // throughout, so the ordinary respawn rule sees nothing wrong.
    d.world.ducks.length = 0;
    d.world.barrels.length = 0;
    d.world.clams.length = 0;
    for (let y = 240; y <= 1240; y += 108) d.world.spawnBarrel('wood', 360, y, 3);
    for (let x = 90; x <= 630; x += 108) d.world.spawnBarrel('wood', x, 740, 3);
    d.world.spawnDuck('red', 180, 450);
    d.world.spawnDuck('green', 540, 450);
    d.world.spawnDuck('yellow', 180, 1010);
    d.world.spawnDuck('purple', 540, 1010);
    d.world.events.length = 0;
    d.drained.length = 0;
    expect(d.world.ducks.length).toBe(d.level.targetDucks); // the count looks fine

    expect(legalShotExists(d)).toBe(false); // genuinely dead to begin with
    const before = d.world.ducks.length;

    for (let t = 0; t < 60 * 6; t++) {
      d.step(SIM.DT);
      if (legalShotExists(d)) break;
    }

    // the guard noticed and put a duck somewhere it can be used
    expect(d.world.ducks.length).toBeGreaterThan(before);
    expect(legalShotExists(d)).toBe(true);
  }, 30_000);

  it('leaves a healthy board alone — no phantom ducks', () => {
    const d = new Director(11, 0);
    d.start();
    const target = d.level.targetDucks;
    for (let t = 0; t < 60 * 10; t++) d.step(SIM.DT);
    // an open board always has a line, so the rescue must never fire
    expect(legalShotExists(d)).toBe(true);
    expect(d.world.ducks.length).toBeLessThanOrEqual(Math.max(target, 2));
  });
});
