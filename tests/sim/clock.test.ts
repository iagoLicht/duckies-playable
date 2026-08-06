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

  it('blocks the slingshot the moment the clock hits zero', () => {
    const d = new Director(3, 0);
    d.start();
    run(d, SIM.LEVEL_TICKS);
    expect(d.slingshot.blocked).toBe(true);
    const duck = d.world.ducks[0]!;
    expect(d.slingshot.begin(duck.x, duck.y)).toBe(false);
  });

  it('publishes whole seconds, once each, counting down', () => {
    const d = new Director(3, 0);
    d.start();
    const seen = run(d, 5 * 60);
    const secs = seen.filter((e) => e.type === 'timeLeft').map((e) => e.seconds);

    // strictly descending, no repeats — one event per whole second, not per tick
    expect(secs.length).toBeLessThanOrEqual(6);
    expect([...secs]).toEqual([...secs].sort((a, b) => b - a));
    expect(new Set(secs).size).toBe(secs.length);
    expect(secs[0]).toBe(30);
  });

  it('still reports "moves" when the budget is what ran out', () => {
    const d = new Director(3, 0);
    d.start();
    d.movesLeft = 0;
    const seen = run(d, 120);
    const failed = seen.find((e) => e.type === 'levelFailed');
    expect(failed).toEqual({ type: 'levelFailed', index: 0, reason: 'moves' });
  });

  it('the clock stops once the level is decided', () => {
    const d = new Director(3, 0);
    d.start();
    d.movesLeft = 0;
    run(d, 120); // fails on moves
    const at = d.secondsLeft;
    for (let t = 0; t < 120; t++) d.step(SIM.DT);
    expect(d.secondsLeft).toBe(at);
  });
});
