import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../src/sim/levels';
import { AD_SCRIPT } from '../../src/game/flow';
import { playLevel, pct, type BotStats } from './bot';

/**
 * The ad's rigged ending, held to its measured shape.
 *
 * Beat 2 ("The Golden Pearl") is DESIGNED to be taken by the clock a hair
 * short of the pearl quota — that is the product, not an accident of tuning,
 * and it was calibrated at 400 clocked seeds (tests/tools/calibrate-clock.mjs;
 * spec: docs/superpowers/specs/2026-08-08-timer-lose-rigged-build-design.md).
 * This gate replays a batch under the real clock and budget and asserts the
 * distribution, so a future balance pass cannot silently turn the ad's ending
 * into a blowout loss, a routine win, or a move-starved fizzle.
 *
 * Bands are deliberately wider than the locked point (thumb 18.5% win, p50 6
 * short) — this is a tripwire for the SHAPE, not a re-run of the calibration.
 *
 * The bands were re-based 2026-08-08 after three user-set constraints each
 * measurably widened the loss distribution: beat-2 spawns must match beat 1
 * (the governor's hold/placement dials removed), spawns land outside pending
 * blast zones, and fresh spawns carry a short shield against explosions in
 * progress. Under all three the calibration sweep's floor is ~18-20% wins
 * with a median 6 short (400 seeds); this 120-seed batch samples that same
 * distribution a point or two wide.
 */
describe('the rigged second beat — near-win clock loss', () => {
  const SEEDS = 120;
  const beat2 = AD_SCRIPT[1]!.level;

  const runs: BotStats[] = [];
  const play = async (): Promise<void> => {
    if (runs.length) return;
    for (let seed = 1; seed <= SEEDS; seed++) {
      runs.push(playLevel(beat2, seed, { unlimitedMoves: false }));
      // long synchronous loops starve the vitest reporter (README)
      if (seed % 25 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  };

  it('generally loses, but stays genuinely winnable', async () => {
    await play();
    const winRate = runs.filter((r) => r.won).length / runs.length;
    expect(winRate).toBeGreaterThan(0.04);
    expect(winRate).toBeLessThan(0.30);
  });

  it('every loss is the clock\'s, never the move budget\'s', async () => {
    await play();
    const losses = runs.filter((r) => !r.won);
    expect(losses.length).toBeGreaterThan(0);
    for (const r of losses) {
      expect(r.end).toBe('failed');
      expect(r.failReason).toBe('time');
    }
  });

  it('losses die close to the quota — a near miss, not a blowout', async () => {
    await play();
    const left = runs.filter((r) => !r.won).map((r) => r.pearlsLeft).sort((a, b) => a - b);
    expect(pct(left, 0.5)).toBeLessThanOrEqual(7);
    const within9 = left.filter((v) => v <= 9).length / left.length;
    expect(within9).toBeGreaterThan(0.75);
  });

  it('the crates fall along the way — the story at 0:00 is pearls, not rubble', async () => {
    await play();
    const losses = runs.filter((r) => !r.won);
    const cratesDown = losses.filter((r) => r.barrelsLeft === 0).length / losses.length;
    expect(cratesDown).toBeGreaterThan(0.7);
  });

  it('beat 1 stays a comfortable win — the rig must not leak backwards', () => {
    const beat1 = AD_SCRIPT[0]!.level;
    expect(LEVELS[beat1]!.pace).toBeUndefined();
    let wins = 0;
    for (let seed = 1; seed <= 40; seed++) {
      if (playLevel(beat1, seed, { unlimitedMoves: false }).won) wins++;
    }
    expect(wins / 40).toBeGreaterThan(0.85);
  });
});
