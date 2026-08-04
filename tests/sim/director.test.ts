import { describe, expect, it } from 'vitest';
import { SIM } from '../../src/sim/config';
import { Director } from '../../src/sim/director';
import { FIELD, LEVELS } from '../../src/sim/levels';
import { collideCircle } from '../../src/sim/shapes';
import type { SimEvent } from '../../src/sim/types';

/**
 * Campaign director tests. LEVELS grows while the game is authored, so EVERY
 * assertion here is derived from the level data itself — never a hardcoded level
 * count, barrel count or coordinate. Adding level 11 must not touch this file.
 */
const run = (d: Director, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds * 60); i++) d.step(SIM.DT);
};

const started = (levelIndex: number, seed = 7): Director => {
  const d = new Director(seed, levelIndex);
  d.start();
  return d;
};

const drain = (d: Director): SimEvent[] => d.drained.splice(0, d.drained.length);
const only = (evs: SimEvent[], type: SimEvent['type']): SimEvent[] =>
  evs.filter((e) => e.type === type);
const has = (evs: SimEvent[], type: SimEvent['type']): boolean => only(evs, type).length > 0;

/**
 * Clear every goal on the board without moving anything. Barrels go in one hit;
 * pearls cannot — a clam dispenses one per cycle, so the quota has to be run out
 * cycle by cycle. The guard is a runaway stop, not a real bound: a board whose
 * quota needs more than 100 cycles is an authoring bug and should fail loudly.
 */
const collectPearlsDownTo = (d: Director, leave: number): void => {
  let guard = 0;
  while (d.pearlCounter.left > leave && guard++ < 100) {
    // trigger only as many clams as we still need, so we cannot overshoot and
    // leave the board in a state the test did not ask for
    const need = d.pearlCounter.left - leave;
    for (const c of d.world.clams.slice(0, need)) d.world.hitClam(c);
    for (let i = 0; i < SIM.CLAM_CYCLE_TICKS; i++) d.step(SIM.DT);
  }
};

const razeAllGoals = (d: Director): void => {
  for (const b of [...d.world.barrels]) d.world.damageBarrel(b, 99);
  collectPearlsDownTo(d, 0);
};

describe('LEVELS authoring', () => {
  it('has at least one level, each with a name, a budget and a goal', () => {
    expect(LEVELS.length).toBeGreaterThan(0);
    LEVELS.forEach((l, i) => {
      expect(l.name, `level ${i} name`).toBeTruthy();
      expect(l.moves, `level ${i} moves`).toBeGreaterThan(0);
      expect(l.assist, `level ${i} assist`).toBeGreaterThanOrEqual(0);
      expect(l.assist, `level ${i} assist`).toBeLessThanOrEqual(1);
      // a shot needs another duck to aim at, so a board must never hold fewer
      // than a pair (the director's respawn floor assumes this too)
      expect(l.targetDucks, `level ${i} targetDucks`).toBeGreaterThanOrEqual(2);
      expect(
        l.barrels.length + l.clams.length,
        `level ${i} "${l.name}" has no barrels and no clams — it is won on frame 1`,
      ).toBeGreaterThan(0);
    });
  });

  it('every authored entity sits clear of the tub walls and the bumpers', () => {
    // collideCircle is the sim's own geometry: a non-null result means the body
    // is literally embedded in a wall or a pink bumper. Ducks get pushed out on
    // the first step, but a barrel or clam is static and stays stuck forever.
    LEVELS.forEach((l, i) => {
      const check = (kind: string, x: number, y: number, r: number): void => {
        const hit = collideCircle(x, y, r);
        expect(
          hit && hit.source,
          `level ${i} "${l.name}": ${kind} at (${x}, ${y}) r${r} overlaps the ${hit?.source}`,
        ).toBeFalsy();
      };
      l.ducks.forEach((d, n) => check(`duck#${n}`, d.x, d.y, SIM.DUCK_R));
      l.barrels.forEach((b, n) => check(`barrel#${n}`, b.x, b.y, SIM.BARREL_R));
      l.clams.forEach((c, n) => check(`clam#${n}`, c.x, c.y, SIM.CLAM_R));
      // The respawn region has to be usable. freeSpot() samples it uniformly and
      // checks other bodies but NOT the tub, so a region hanging outside the
      // playfield would drop ducks into the wall. The tub tapers at the top
      // shoulders, so the extreme corners of a top-of-board region can clip it —
      // a few percent is cosmetic, a badly placed region is not.
      const R = l.spawnRegion;
      expect(R.x1, `level ${i} spawnRegion x`).toBeGreaterThan(R.x0);
      expect(R.y1, `level ${i} spawnRegion y`).toBeGreaterThan(R.y0);
      expect(R.x0, `level ${i} spawnRegion x0`).toBeGreaterThanOrEqual(FIELD.x0 + SIM.DUCK_R);
      expect(R.x1, `level ${i} spawnRegion x1`).toBeLessThanOrEqual(FIELD.x1 - SIM.DUCK_R);
      expect(R.y0, `level ${i} spawnRegion y0`).toBeGreaterThanOrEqual(FIELD.y0 + SIM.DUCK_R);
      expect(R.y1, `level ${i} spawnRegion y1`).toBeLessThanOrEqual(FIELD.y1 - SIM.DUCK_R);

      const N = 40;
      let blocked = 0;
      for (let a = 0; a <= N; a++) {
        for (let b = 0; b <= N; b++) {
          const x = R.x0 + ((R.x1 - R.x0) * a) / N;
          const y = R.y0 + ((R.y1 - R.y0) * b) / N;
          if (collideCircle(x, y, SIM.DUCK_R)) blocked++;
        }
      }
      expect(
        blocked / ((N + 1) * (N + 1)),
        `level ${i} "${l.name}": spawnRegion is mostly inside the tub wall`,
      ).toBeLessThan(0.05);
    });
  });

  it('no two authored bodies start overlapping', () => {
    LEVELS.forEach((l, i) => {
      const bodies = [
        ...l.ducks.map((d, n) => ({ tag: `duck#${n}`, x: d.x, y: d.y, r: SIM.DUCK_R })),
        ...l.barrels.map((b, n) => ({ tag: `barrel#${n}`, x: b.x, y: b.y, r: SIM.BARREL_R })),
        ...l.clams.map((c, n) => ({ tag: `clam#${n}`, x: c.x, y: c.y, r: SIM.CLAM_R })),
      ];
      for (let a = 0; a < bodies.length; a++) {
        for (let b = a + 1; b < bodies.length; b++) {
          const A = bodies[a]!, B = bodies[b]!;
          expect(
            Math.hypot(A.x - B.x, A.y - B.y),
            `level ${i} "${l.name}": ${A.tag} overlaps ${B.tag}`,
          ).toBeGreaterThanOrEqual(A.r + B.r);
        }
      }
    });
  });

  it('FIELD stays consistent with the collision geometry', () => {
    expect(FIELD.x1).toBeGreaterThan(FIELD.x0);
    expect(FIELD.y1).toBeGreaterThan(FIELD.y0);
    // the documented interior really is free space one duck-radius in
    expect(collideCircle(FIELD.x0 + SIM.DUCK_R, 700, SIM.DUCK_R)).toBeNull();
    expect(collideCircle(FIELD.x1 - SIM.DUCK_R, 700, SIM.DUCK_R)).toBeNull();
  });
});

describe('Director construction', () => {
  it('rejects a level index the campaign does not have', () => {
    expect(() => new Director(1, LEVELS.length)).toThrow(/no level at index/);
    expect(() => new Director(1, -1)).toThrow(/no level at index/);
  });

  it('is deterministic: the same seed and level replay identically', () => {
    const a = started(0, 99);
    const b = started(0, 99);
    const script = (d: Director): string => {
      const duck = d.world.ducks[0];
      if (duck) d.world.launch(duck.id, 600, -900);
      run(d, 6);
      return JSON.stringify(d.drained.map((e) => e.type));
    };
    expect(script(a)).toBe(script(b));
    expect(a.counter).toEqual(b.counter);
    expect(a.movesLeft).toBe(b.movesLeft);
  });
});

for (let index = 0; index < LEVELS.length; index++) {
  const level = LEVELS[index]!;
  // clams are no longer goals — the crate counter is barrels only, and pearls
  // are counted separately by their own quota
  const goals = level.barrels.length;

  describe(`Director — level ${index} "${level.name}"`, () => {
    it('start() builds the authored board and announces the level', () => {
      const d = started(index);

      expect(d.levelIndex).toBe(index);
      expect(d.level).toBe(level);
      expect(d.world.ducks).toHaveLength(level.ducks.length);
      expect(d.world.barrels).toHaveLength(level.barrels.length);
      expect(d.world.clams).toHaveLength(level.clams.length);
      expect(d.world.clams.every((c) => !c.open)).toBe(true);
      expect(d.movesLeft).toBe(level.moves);
      expect(d.slingshot.assist).toBeCloseTo(level.assist);
      expect(d.counter).toEqual({ done: 0, total: goals });
      expect(d.pearlCounter).toEqual({ left: level.pearls, total: level.pearls });
      expect(d.world.clams.every((c) => c.active)).toBe(true);
      expect(d.won).toBe(false);
      expect(d.failed).toBe(false);
      expect(d.finaleArmed).toBe(false);

      // the setup spawns ride in the same stream as the header — nothing leaks
      // into the first step()
      const evs = drain(d);
      expect(only(evs, 'duckSpawned')).toHaveLength(level.ducks.length);
      expect(only(evs, 'barrelSpawned')).toHaveLength(level.barrels.length);
      expect(only(evs, 'clamSpawned')).toHaveLength(level.clams.length);
      expect(only(evs, 'levelStarted')).toEqual([
        { type: 'levelStarted', index, name: level.name, moves: level.moves },
      ]);
      expect(only(evs, 'counter')).toEqual([{ type: 'counter', done: 0, total: goals }]);
      expect(only(evs, 'pearlCounter')).toEqual([
        { type: 'pearlCounter', left: level.pearls, total: level.pearls },
      ]);
      expect(only(evs, 'movesLeft')).toEqual([{ type: 'movesLeft', left: level.moves }]);
      d.step(SIM.DT);
      expect(drain(d).filter((e) => e.type.endsWith('Spawned'))).toHaveLength(0);
    });

    it('a real launch spends exactly one move and reports the new count', () => {
      const d = started(index);
      drain(d);
      const duck = d.world.ducks[0]!;
      d.world.launch(duck.id, 0, -SIM.LAUNCH_SPEED);
      d.step(SIM.DT);

      expect(d.movesLeft).toBe(level.moves - 1);
      expect(only(drain(d), 'movesLeft')).toEqual([{ type: 'movesLeft', left: level.moves - 1 }]);
    });

    it('a whiff — a grab released under MIN_PULL — costs nothing', () => {
      const d = started(index);
      const duck = d.world.ducks[0]!;
      expect(d.slingshot.begin(duck.x, duck.y)).toBe(true);
      expect(d.slingshot.end()).toBe(false); // never moved: pull < MIN_PULL
      d.step(SIM.DT);
      expect(d.movesLeft).toBe(level.moves);
      expect(d.world.ducks.some((k) => k.live)).toBe(false);
    });

    it('a refused aim — the guide does not lock a duck — costs nothing', () => {
      const d = started(index);
      const duck = d.world.ducks[0]!;
      expect(d.slingshot.begin(duck.x, duck.y)).toBe(true);
      // sweep for an angle the release rejects; on a populated board most aims
      // land on a wall or a barrel, so this is found within a turn or two
      let refused = false;
      for (let deg = 0; deg < 360 && !refused; deg += 5) {
        const a = (deg * Math.PI) / 180;
        d.slingshot.move(duck.x - Math.cos(a) * 150, duck.y - Math.sin(a) * 150);
        refused = d.slingshot.preview()?.hitKind !== 'duck';
      }
      expect(refused, 'no refused aim exists on this board').toBe(true);

      expect(d.slingshot.end()).toBe(false);
      d.step(SIM.DT);
      expect(d.movesLeft).toBe(level.moves);
      expect(d.world.ducks.some((k) => k.live)).toBe(false);
    });

    it('clearing every barrel and collecting every pearl wins the level', () => {
      const d = started(index);
      drain(d);
      razeAllGoals(d);
      run(d, 1);

      expect(d.won).toBe(true);
      expect(d.failed).toBe(false);
      expect(d.counter).toEqual({ done: goals, total: goals });
      expect(d.pearlCounter.left).toBe(0);
      const evs = drain(d);
      expect(only(evs, 'levelCleared')).toEqual([
        { type: 'levelCleared', index, movesLeft: level.moves },
      ]);
      expect(has(evs, 'won')).toBe(true);

      // and it stays won — no repeat announcements
      run(d, 2);
      expect(only(drain(d), 'levelCleared')).toHaveLength(0);
    });

    it('a pearl decrements the quota only when it REACHES the counter', () => {
      if (level.clams.length === 0) return; // nothing to assert on this board
      const d = started(index);
      drain(d);
      const before = d.pearlCounter.left;
      d.world.hitClam(d.world.clams[0]!);

      // spilled on the impact frame but still in flight: the number has not moved
      for (let i = 0; i < SIM.PEARL_FLIGHT_TICKS - 1; i++) d.step(SIM.DT);
      expect(d.pearlCounter.left).toBe(before);

      d.step(SIM.DT);
      expect(d.pearlCounter.left).toBe(before - 1);
      expect(has(drain(d), 'pearlCounter')).toBe(true);
      // the crate counter is untouched by pearls
      expect(d.counter.total).toBe(level.barrels.length);
    });

    it('the clams go inert the moment the pearl quota is met, and stay visible', () => {
      if (level.clams.length === 0) return;
      const d = started(index);
      drain(d);
      razeAllGoals(d);
      run(d, 1);

      expect(d.pearlCounter.left).toBe(0);
      expect(d.world.clams).toHaveLength(level.clams.length); // still on the board
      expect(d.world.clams.every((c) => !c.active)).toBe(true);

      // and a further hit yields nothing at all
      drain(d);
      for (const c of d.world.clams) d.world.hitClam(c);
      run(d, SIM.CLAM_CYCLE_TICKS);
      const evs = drain(d);
      expect(only(evs, 'clamOpened')).toHaveLength(0);
      expect(only(evs, 'pearlCollected')).toHaveLength(0);
    });

    it('the budget only bites once the board has come to rest', () => {
      const d = started(index);
      drain(d);
      d.movesLeft = 0;
      // 60 px/s: fast enough to count as motion (> STOP_SPEED) but under every
      // damage threshold, so the board cannot accidentally clear itself
      const duck = d.world.ducks[0]!;
      duck.vx = 60;
      d.step(SIM.DT);
      expect(d.boardSettled()).toBe(false);
      expect(d.failed).toBe(false);

      run(d, 5);
      expect(d.boardSettled()).toBe(true);
      expect(d.failed).toBe(true);
      expect(d.won).toBe(false);
      expect(only(drain(d), 'levelFailed')).toEqual([{ type: 'levelFailed', index }]);

      // announced once, not once a frame
      run(d, 2);
      expect(only(drain(d), 'levelFailed')).toHaveLength(0);
    });

    it('a settled board with the budget spent but no goals left wins, not fails', () => {
      const d = started(index);
      // clear the goals FIRST, then spend the budget: razing pearls takes real
      // ticks now, and a board with the budget already at zero and pearls still
      // outstanding is a legitimate failure, which is not what this asserts
      razeAllGoals(d);
      d.movesLeft = 0;
      run(d, 2);
      expect(d.won).toBe(true);
      expect(d.failed).toBe(false);
    });

    it('the last move cracking a clam is never failed out from under the pearl', () => {
      if (level.clams.length === 0) return;
      const d = started(index);
      drain(d);
      // spend the budget down to nothing and open a clam: the board goes
      // completely still while the pearl is mid-flight
      d.movesLeft = 0;
      d.world.hitClam(d.world.clams[0]!);
      // ticks, not seconds — run() takes seconds, and the whole point of this
      // test is the exact window between the crack and the pearl landing
      for (let i = 0; i < SIM.PEARL_FLIGHT_TICKS; i++) d.step(SIM.DT);

      expect(d.failed).toBe(false);
      expect(has(drain(d), 'levelFailed')).toBe(false);
      // the pearl it earned was counted
      expect(d.pearlCounter.left).toBe(Math.max(0, level.pearls - 1));
    });

    it('respawns top the field back up to the level target', () => {
      const d = started(index);
      d.movesLeft = 99; // isolate respawn behaviour from the fail check
      d.world.ducks.length = 0;
      run(d, 8);
      expect(d.world.ducks).toHaveLength(Math.max(level.targetDucks, 2));
      expect(d.world.ducks.every((k) => !k.live)).toBe(true);
    });

    it('never softlocks: a lone duck is always given a partner to aim at', () => {
      const d = started(index);
      d.movesLeft = 99;
      d.world.ducks.splice(1); // leave exactly one
      run(d, 6);
      expect(d.world.ducks.length).toBeGreaterThanOrEqual(2);
    });

    it('respawned ducks land clear of every barrel and clam', () => {
      const d = started(index);
      d.movesLeft = 99;
      d.world.ducks.length = 0;
      run(d, 8);
      for (const k of d.world.ducks) {
        for (const b of d.world.barrels) {
          expect(Math.hypot(k.x - b.x, k.y - b.y)).toBeGreaterThan(SIM.DUCK_R + SIM.BARREL_R);
        }
        for (const c of d.world.clams) {
          expect(Math.hypot(k.x - c.x, k.y - c.y)).toBeGreaterThan(SIM.DUCK_R + SIM.CLAM_R);
        }
      }
    });

    it('the finale arms on the last goal standing and cranks the assist', () => {
      const d = started(index);
      d.movesLeft = 99;
      drain(d);
      // leave exactly one goal alive, preferring a barrel when there is one
      if (d.world.barrels.length > 0) {
        const keep = d.world.barrels[0]!;
        for (const b of [...d.world.barrels]) if (b !== keep) d.world.damageBarrel(b, 99);
        collectPearlsDownTo(d, 0);
      } else {
        collectPearlsDownTo(d, 1);
      }
      run(d, 1);

      expect(d.won).toBe(false);
      // the invariant is one OUTSTANDING goal of either kind — which counter it
      // sits in depends on how the board is authored
      expect(d.goalsRemaining).toBe(1);
      expect(d.finaleArmed).toBe(true);
      expect(d.slingshot.assist).toBeGreaterThanOrEqual(0.9);
      expect(only(drain(d), 'finaleArmed')).toHaveLength(1);

      // armed once and only once
      run(d, 2);
      expect(only(drain(d), 'finaleArmed')).toHaveLength(0);
    });
  });
}
