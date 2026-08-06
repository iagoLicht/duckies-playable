import { describe, expect, it } from 'vitest';
import { SIM } from '../../src/sim/config';
import { Director } from '../../src/sim/director';
import type { SimEvent } from '../../src/sim/types';

/**
 * The countdown has to bind in the SIM, not the view. It shipped as a display
 * number that did nothing at zero; anything driving the sim directly (a bot, a
 * test, the tuner) would never see it. These pin it shut, the same way
 * moves.test.ts pins the move budget.
 */
describe('the level clock binds at the sim level', () => {
  /** step until the level is decided or `ticks` runs out, collecting events */
  const run = (d: Director, ticks: number): SimEvent[] => {
    const seen: SimEvent[] = [];
    for (let t = 0; t < ticks; t++) {
      d.step(SIM.DT);
      seen.push(...d.drained.splice(0, d.drained.length));
      if (d.failed || d.won) break;
    }
    return seen;
  };

  it('fails the level with reason "time" once the countdown is spent', () => {
    const d = new Director(3, 0);
    d.start();

    // never fire a shot: moves are untouched, so only the clock can end this
    const seen = run(d, SIM.LEVEL_TICKS + 300);
    const failed = seen.find((e) => e.type === 'levelFailed');

    expect(d.failed).toBe(true);
    expect(failed).toEqual({ type: 'levelFailed', index: 0, reason: 'time' });
    expect(d.movesLeft).toBeGreaterThan(0); // moves were never the cause
  });

  it('does not fail one tick early', () => {
    const d = new Director(3, 0);
    d.start();
    run(d, SIM.LEVEL_TICKS - 1);
    expect(d.failed).toBe(false);
  });

  it('blocks the slingshot at zero even though the board is not decided yet', () => {
    const d = new Director(3, 0);
    d.start();
    run(d, SIM.LEVEL_TICKS - 1);

    // The board must still be MOVING as the clock runs out, or this proves
    // nothing: syncBlocked() is a disjunction that already includes `failed`,
    // so a settled board at 0:00 is blocked whether or not the clock clause
    // exists. Holding it un-settled is the only way to isolate that clause.
    // 60 px/s is the same trick director.test.ts uses — over STOP_SPEED so the
    // board reads as moving, under every damage threshold so nothing clears.
    d.world.ducks[0]!.vx = 60;
    d.step(SIM.DT);

    expect(d.secondsLeft).toBe(0);
    expect(d.failed).toBe(false); // the settle rule has not fired yet…
    expect(d.slingshot.blocked).toBe(true); // …but the NEXT shot is already gone
    const still = d.world.ducks[1]!;
    expect(d.slingshot.begin(still.x, still.y)).toBe(false);
  });

  it('publishes whole seconds, once each, counting down', () => {
    const d = new Director(3, 0);
    d.start();
    const seen = run(d, 5 * 60);
    const secs = seen.filter((e) => e.type === 'timeLeft').map((e) => e.seconds);

    // Exactly one event per whole second, descending, no repeats and none
    // missing. Pinned as a literal rather than as bounds: "at most 6" is
    // satisfied by an emitter that publishes four, which is the failure a
    // per-tick-vs-per-second regression would actually produce.
    expect(secs).toEqual([30, 29, 28, 27, 26, 25]);
  });

  it('still reports "moves" when the budget is what ran out', () => {
    const d = new Director(3, 0);
    d.start();
    d.movesLeft = 0;
    const seen = run(d, 120);
    const failed = seen.find((e) => e.type === 'levelFailed');
    expect(failed).toEqual({ type: 'levelFailed', index: 0, reason: 'moves' });
  });

  /**
   * The one this change gets wrong most easily. Failing the board the instant
   * `ticksLeft` hits zero — i.e. dropping `boardSettled()` from the fail check —
   * passes every other test here. This is the witness for the settle rule: a
   * chain still resolving at 0:00 keeps the level alive, and a clear that lands
   * inside that window is a WIN, not a loss that happened to be late.
   */
  it('a chain still resolving at 0:00 still gets to clear the level', () => {
    const d = new Director(3, 0);
    d.start();
    run(d, SIM.LEVEL_TICKS - 1);

    const seen: SimEvent[] = [];
    const mover = d.world.ducks[0]!;
    // re-armed every tick: drag would settle it in about nine, and the moment it
    // settles the fail check fires and the window this test is about is gone
    const stepMoving = (n: number): void => {
      for (let t = 0; t < n; t++) {
        mover.vx = 60;
        d.step(SIM.DT);
        seen.push(...d.drained.splice(0, d.drained.length));
      }
    };

    stepMoving(1); // the tick the clock runs out on
    expect(d.secondsLeft).toBe(0);
    expect(d.boardSettled()).toBe(false);
    expect(d.failed).toBe(false); // out of time, but nothing is decided yet

    // the chain pays off inside the window. Level 0 has no clams and a zero
    // pearl quota, so every goal on it is a barrel.
    for (const b of [...d.world.barrels]) d.world.damageBarrel(b, 99);
    stepMoving(2);

    expect(d.won).toBe(true);
    expect(d.failed).toBe(false);
    expect(seen.some((e) => e.type === 'levelCleared')).toBe(true);
    expect(seen.some((e) => e.type === 'levelFailed')).toBe(false);
  });

  it('the clock stops once the level is decided, whichever way it went', () => {
    const lost = new Director(3, 0);
    lost.start();
    lost.movesLeft = 0;
    run(lost, 120); // fails on moves
    expect(lost.failed).toBe(true);
    const lostAt = lost.secondsLeft;
    for (let t = 0; t < 120; t++) lost.step(SIM.DT);
    expect(lost.secondsLeft).toBe(lostAt);

    // `!this.won` is a separate clause in the tick guard and needs its own
    // witness — the failed branch alone leaves deleting it green. A cleared
    // board sits under the celebration for LEVEL_ADVANCE_DELAY, and its HUD
    // must not keep counting down behind it.
    const cleared = new Director(3, 0);
    cleared.start();
    for (const b of [...cleared.world.barrels]) cleared.world.damageBarrel(b, 99);
    run(cleared, 2);
    expect(cleared.won).toBe(true);
    const wonAt = cleared.secondsLeft;
    for (let t = 0; t < 120; t++) cleared.step(SIM.DT);
    expect(cleared.secondsLeft).toBe(wonAt);
  });
});
