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
      title: 'CONGRATULATIONS!',
      subtitle: 'You crushed it!',
      buttonLabel: 'NEXT LEVEL',
      buttonAction: 'advance',
      advanceTo: BEAT_2,
      storeLink: true,
    });
  });

  it('beat one failed: its own card — TRY AGAIN, and it goes to the store', () => {
    // user-set 2026-08-07: losing the first board no longer restarts it. Same
    // card, same art, same copy as beat two's; only the CTA wording differs,
    // and the button is the store either way. Nothing here reloads a level.
    expect(outcomeFor(BEAT_1, false)).toEqual({
      kind: 'card',
      title: 'SO CLOSE!',
      subtitle: "You'll get them next time!",
      buttonLabel: 'TRY AGAIN',
      buttonAction: 'store',
      advanceTo: null,
      storeLink: false,
    });
  });

  it('beat two failed: the lose card, and it is the end', () => {
    expect(outcomeFor(BEAT_2, false)).toEqual({
      kind: 'card',
      title: 'SO CLOSE!',
      subtitle: "You'll get them next time!",
      buttonLabel: 'PLAY NOW',
      buttonAction: 'store',
      advanceTo: null,
      storeLink: false,
    });
  });

  it('beat two cleared: still the end, still the store', () => {
    expect(outcomeFor(BEAT_2, true)).toEqual({
      kind: 'card',
      title: 'CONGRATULATIONS!',
      subtitle: 'You crushed it!',
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

  it('NO fail anywhere in the ad ever replays a board', () => {
    // the one property that used to have an exception (beat one's quiet
    // restart) and now has none: a viewer who loses is always handed the store
    for (const b of AD_SCRIPT) {
      const o = outcomeFor(b.level, false);
      expect(o.kind).toBe('card');
      if (o.kind !== 'card') throw new Error('unreachable');
      expect(o.title).toBe('SO CLOSE!');
      expect(o.buttonAction).toBe('store');
      expect(o.advanceTo).toBeNull();
    }
  });

  it('every card carries BOTH lines, and the right pair of them', () => {
    // the card is built from one CardCopy value, so a winning banner can never
    // end up over a losing line — this is the property that guarantees it
    for (const level of AD_SCRIPT.map((b) => b.level)) {
      for (const cleared of [true, false]) {
        const o = outcomeFor(level, cleared);
        if (o.kind !== 'card') throw new Error('unreachable');
        expect(o.title, `level ${level} cleared=${cleared}`).toBeTruthy();
        expect(o.subtitle, `level ${level} cleared=${cleared}`).toBeTruthy();
        // caps shout the verdict, sentence case answers it — never the reverse
        expect(o.title).toBe(o.title.toUpperCase());
        expect(o.subtitle).not.toBe(o.subtitle.toUpperCase());
      }
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
