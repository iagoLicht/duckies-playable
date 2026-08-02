import { describe, expect, it } from 'vitest';
import { SIM } from '../../src/sim/config';
import { Director } from '../../src/sim/director';

const run = (d: Director, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds * 60); i++) d.step(SIM.DT);
};

describe('Director', () => {
  it('starts wave 1 with the locked layout: 4 ducks, 6 barrels, counter 0/13', () => {
    const d = new Director(7);
    d.start();
    expect(d.world.ducks).toHaveLength(4);
    expect(d.world.barrels).toHaveLength(6);
    expect(d.counter).toEqual({ done: 0, total: 13 });
    expect(d.slingshot.assist).toBeCloseTo(0.35);
  });

  it('advances to wave 2 when all wave-1 barrels die, and raises assist', () => {
    const d = new Director(7);
    d.start();
    for (const b of [...d.world.barrels]) d.world.damageBarrel(b, 99);
    run(d, 1);
    expect(d.wave).toBe(2);
    expect(d.world.barrels).toHaveLength(6);
    expect(d.counter.done).toBe(6);
    expect(d.slingshot.assist).toBeCloseTo(0.55);
  });

  it('respawns popped ducks back up to the wave target', () => {
    const d = new Director(7);
    d.start();
    const duck = d.world.ducks[0]!;
    d.world.blast(duck.colour, duck.x, duck.y); // pops at least that duck
    run(d, 2);
    expect(d.world.ducks.length).toBe(4);
  });

  it('wave 3: golden barrel at 1hp stops respawns and arms the finale', () => {
    const d = new Director(7);
    d.start();
    // clear waves 1 and 2
    for (const b of [...d.world.barrels]) d.world.damageBarrel(b, 99);
    run(d, 1);
    for (const b of [...d.world.barrels]) d.world.damageBarrel(b, 99);
    run(d, 1);
    expect(d.wave).toBe(3);
    const golden = d.world.barrels[0]!;
    expect(golden.golden).toBe(true);
    expect(golden.hp).toBe(3);
    // bring golden to 1hp
    d.world.damageBarrel(golden, 2);
    // pop ducks down to one
    while (d.world.ducks.length > 1) {
      const duck = d.world.ducks[0]!;
      d.world.blast(duck.colour, duck.x, duck.y);
      run(d, 0.5);
    }
    run(d, 3);
    expect(d.world.ducks.length).toBe(1); // no respawn while finale armed
    expect(d.world.events.concat(d.drained).some((e) => e.type === 'finaleArmed')).toBe(true);
    expect(d.slingshot.assist).toBeCloseTo(0.95);
  });

  it('destroying the golden barrel wins', () => {
    const d = new Director(7);
    d.start();
    for (const b of [...d.world.barrels]) d.world.damageBarrel(b, 99);
    run(d, 1);
    for (const b of [...d.world.barrels]) d.world.damageBarrel(b, 99);
    run(d, 1);
    d.world.damageBarrel(d.world.barrels[0]!, 99);
    run(d, 0.5);
    expect(d.won).toBe(true);
    expect(d.counter.done).toBe(13);
  });

  it('never softlocks: if every duck dies pre-finale, one respawns', () => {
    const d = new Director(7);
    d.start();
    while (d.world.ducks.length > 0) {
      const duck = d.world.ducks[0]!;
      d.world.blast(duck.colour, duck.x, duck.y);
      run(d, 0.2);
    }
    run(d, 2);
    expect(d.world.ducks.length).toBeGreaterThan(0);
  });
});
