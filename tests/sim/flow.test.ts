import { describe, expect, it } from 'vitest';
import { AD_SCRIPT, FIRST_BEAT, outcomeFor } from '../../src/game/flow';
import { LEVELS } from '../../src/sim/levels';

/**
 * One test per row of the ad's outcome table. The property that matters most is
 * the last one: beat two is a WALL — however it resolves, the run ends at the
 * store. An ad with a branch that leaves the viewer nothing to tap is a dead ad,
 * and that branch (clearing the board that is supposed to beat you) is exactly
 * the one nobody plays by hand.
 *
 * flow.ts lives in src/game but imports no Pixi, which is what lets it be
 * decided here rather than in a browser.
 */
describe('the ad script', () => {
  const BEAT_1 = AD_SCRIPT[0]!.level;
  const BEAT_2 = AD_SCRIPT[1]!.level;

  it('points at two real levels and opens on the first', () => {
    expect(AD_SCRIPT).toHaveLength(2);
    for (const b of AD_SCRIPT) expect(LEVELS[b.level]).toBeDefined();
    expect(FIRST_BEAT).toBe(BEAT_1);
  });

  it('beat one cleared: a win card whose button walks you onward', () => {
    expect(outcomeFor(BEAT_1, true)).toEqual({
      kind: 'card',
      title: 'YOU WIN!',
      buttonLabel: 'NEXT LEVEL',
      buttonAction: 'advance',
      advanceTo: BEAT_2,
      storeLink: true,
    });
  });

  it('beat one failed: the board quietly restarts and NO card is shown', () => {
    expect(outcomeFor(BEAT_1, false)).toEqual({ kind: 'restart' });
  });

  it('beat two failed: the lose card, and it is the end', () => {
    expect(outcomeFor(BEAT_2, false)).toEqual({
      kind: 'card',
      title: 'YOU LOST',
      buttonLabel: 'PLAY NOW',
      buttonAction: 'store',
      advanceTo: null,
      storeLink: false,
    });
  });

  it('beat two cleared: still the end, still the store', () => {
    expect(outcomeFor(BEAT_2, true)).toEqual({
      kind: 'card',
      title: 'YOU WIN!',
      buttonLabel: 'PLAY NOW',
      buttonAction: 'store',
      advanceTo: null,
      storeLink: false,
    });
  });

  it('EVERY outcome of beat two is terminal and offers the store', () => {
    for (const cleared of [true, false]) {
      const o = outcomeFor(BEAT_2, cleared);
      expect(o.kind).toBe('card');
      if (o.kind !== 'card') throw new Error('unreachable');
      expect(o.buttonAction).toBe('store');
      expect(o.advanceTo).toBeNull();
    }
  });

  it('no card can ever appear on a mustWin beat that was lost', () => {
    for (const b of AD_SCRIPT.filter((x) => x.mustWin)) {
      expect(outcomeFor(b.level, false).kind).toBe('restart');
    }
  });

  it('off-script levels keep the old campaign behaviour for the dev picker', () => {
    // level 0 is not in the ad, but ?level=1 must still be playable
    expect(outcomeFor(0, false)).toEqual({ kind: 'restart' });
    expect(outcomeFor(0, true)).toEqual({ kind: 'advance', level: 1 });
    // and the very last level has nowhere to advance to
    expect(outcomeFor(LEVELS.length - 1, true).kind).not.toBe('advance');
  });
});
