import { describe, expect, it } from 'vitest';
import { SIM } from '../../src/sim/config';
import { Director } from '../../src/sim/director';

/**
 * The move budget has to bind in the SIM, not just in the view. The view refuses
 * grabs, but anything driving the sim directly (a bot, a test, a future replay)
 * could otherwise keep firing at zero moves — and because a fresh shot un-settles
 * the board, the failure check would never get to run. That combination made the
 * budget cosmetic; this pins it shut.
 */
describe('the move budget binds at the sim level', () => {
  const fireAtAnything = (d: Director): void => {
    const duck = d.world.ducks.find((k) => !k.live && !k.popping && !k.matched);
    if (!duck || !d.slingshot.begin(duck.x, duck.y)) return;
    const other = d.world.ducks.find((k) => k.id !== duck.id);
    if (other) {
      const base = Math.atan2(other.y - duck.y, other.x - duck.x);
      const aimAt = (a: number): void =>
        d.slingshot.move(duck.x - Math.cos(a) * 170, duck.y - Math.sin(a) * 170);
      aimAt(base);
      // swing until the guide locks a duck, the same hunt a player performs
      if (d.slingshot.preview()?.hitKind !== 'duck') {
        for (let s = 1; s <= 60; s++) {
          const off = (s * 3 * Math.PI) / 180;
          aimAt(base + off);
          if (d.slingshot.preview()?.hitKind === 'duck') break;
          aimAt(base - off);
          if (d.slingshot.preview()?.hitKind === 'duck') break;
        }
      }
    }
    d.slingshot.end();
  };

  it('spends exactly the budget, then refuses every further launch and fails', () => {
    const d = new Director(3, 0);
    d.start();
    d.movesLeft = 1; // one shot in the bank

    let launches = 0;
    for (let t = 0; t < 60 * 60; t++) {
      d.step(SIM.DT);
      for (const e of d.drained.splice(0, d.drained.length)) {
        if (e.type === 'duckLaunched') launches++;
      }
      fireAtAnything(d); // a caller that ignores the view's gate entirely
      if (d.failed || d.won) break;
    }

    expect(launches).toBe(1);
    expect(d.movesLeft).toBe(0);
    expect(d.slingshot.blocked).toBe(true);
    // one shot cannot clear level 1, so the budget must actually end the level
    expect(d.failed).toBe(true);
  });

  it('two gestures inside one frame cannot both spend the last move', () => {
    const d = new Director(3, 0);
    d.start();
    d.movesLeft = 1;

    // no step() between them: this is the double-fling / queued-pointer case.
    // The budget used to be debited only when the NEXT step drained the launch
    // event, so the second gesture read a stale movesLeft and fired for free.
    let launched = 0;
    for (let i = 0; i < 4; i++) {
      const before = d.world.ducks.filter((k) => k.live).length;
      fireAtAnything(d);
      if (d.world.ducks.filter((k) => k.live).length > before) launched++;
    }

    expect(launched).toBeLessThanOrEqual(1);
    // the shot in flight is counted against the budget immediately, which is
    // what refuses the second gesture; the debit itself lands on the next step
    expect(d.slingshot.blocked).toBe(true);
    d.step(SIM.DT);
    expect(d.movesLeft).toBe(0);
  });

  it('a blocked slingshot refuses the grab outright', () => {
    const d = new Director(3, 0);
    d.start();
    d.movesLeft = 0;
    d.step(SIM.DT); // director publishes the block
    const duck = d.world.ducks[0]!;
    expect(d.slingshot.begin(duck.x, duck.y)).toBe(false);
    expect(d.slingshot.aiming).toBe(false);
  });
});
