import { describe, expect, it } from 'vitest';
import { pct, playLevel, type BotStats } from './bot';
import { LEVELS } from '../../src/sim/levels';

/**
 * The per-level SOLVABILITY gate.
 *
 * Every board in the campaign must be beatable by the distracted-thumb bot in
 * tests/sim/bot.ts, on every seed. The bot runs with the move budget effectively
 * disabled: the question this gate answers is "can this board be cleared at
 * all?", NOT "is the shipped `moves` value winnable" — that is a tuning decision,
 * made from the shot-count percentiles printed below and by
 * `node tests/tools/tune-levels.mjs`.
 *
 * A level that fails here is broken level data (an unreachable goal, a clam
 * walled off from every lane, a board that cannot generate a blast), not a
 * budget that needs loosening.
 */
const SEEDS_PER_LEVEL = 120;

/** yield to the worker's event loop or the reporter RPC ("onTaskUpdate") times out */
const YIELD_EVERY = 25;

const summarise = (runs: BotStats[]): Record<string, string | number> => {
  const shots = runs.map((r) => r.shots).sort((a, b) => a - b);
  const avg = (f: (r: BotStats) => number): number =>
    runs.reduce((s, r) => s + f(r), 0) / runs.length;
  return {
    wins: `${runs.filter((r) => r.won).length}/${runs.length}`,
    goals: runs[0]!.goals,
    budget: runs[0]!.budget,
    p50: pct(shots, 0.5),
    p75: pct(shots, 0.75),
    p90: pct(shots, 0.9),
    max: shots[shots.length - 1]!,
    blasts: avg((r) => r.blasts).toFixed(1),
    clams: avg((r) => r.clamsOpened).toFixed(1),
    secs: avg((r) => r.seconds).toFixed(1),
  };
};

describe('campaign playthrough — every level is solvable', () => {
  it('LEVELS is non-empty (nothing to gate otherwise)', () => {
    expect(LEVELS.length).toBeGreaterThan(0);
  });

  for (let index = 0; index < LEVELS.length; index++) {
    const level = LEVELS[index]!;

    it(`level ${index} "${level.name}": ${SEEDS_PER_LEVEL} bot runs all clear it`, async () => {
      const runs: BotStats[] = [];
      for (let seed = 1; seed <= SEEDS_PER_LEVEL; seed++) {
        runs.push(playLevel(index, seed, { unlimitedMoves: true }));
        if (seed % YIELD_EVERY === 0) await new Promise((r) => setTimeout(r, 0));
      }

      const row = summarise(runs);
      // eslint-disable-next-line no-console
      console.log(`level ${index} "${level.name}"`, row);

      const lost = runs.filter((r) => !r.won);
      expect(
        lost.map((r) => `seed ${r.seed} (${r.end}, ${r.shots} shots)`).join(', '),
      ).toBe('');
      expect(lost).toHaveLength(0);

      // sanity on the bot itself: it actually had to work for it
      expect(runs.every((r) => r.shots > 0)).toBe(true);
      // and every goal really was retired, clams included
      const clamGoals = level.clams.length;
      expect(runs.every((r) => r.clamsOpened >= clamGoals)).toBe(true);
    }, 600_000);
  }
});
