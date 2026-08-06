import { LEVELS } from '../sim/levels';

/**
 * The ad is a two-beat story, not a campaign run.
 *
 * Beat one is a DOOR: clear it and walk through to the next board. Beat two is
 * a WALL: however it resolves, the run is over and the only thing left to do is
 * install. That asymmetry is the whole shape of the thing, and it lives here as
 * data rather than as level-index comparisons scattered through scene.ts.
 *
 * No Pixi imports — this is decided headless and tested headless.
 */
export interface Beat {
  /** index into LEVELS */
  level: number;
  /**
   * true if the viewer must not be allowed to lose here. A fail on a mustWin
   * beat quietly restarts the board instead of ending the run, so the first
   * card anyone sees is always the win.
   */
  mustWin: boolean;
}

export const AD_SCRIPT: Beat[] = [
  { level: 8, mustWin: true },   // "9. The Gauntlet"     — the viewer clears this
  { level: 9, mustWin: false },  // "10. The Golden Pearl" — the clock takes it
];

/** Where the ad opens. */
export const FIRST_BEAT = AD_SCRIPT[0]!.level;

/** From the home-task brief, which asks only that the CTA link somewhere. */
export const STORE_URL =
  'https://play.google.com/store/apps/details?id=com.candivore.duckies';

export type Outcome =
  /** swap the same board back in — no card, no ceremony */
  | { kind: 'restart' }
  /** straight into another board, no card in between */
  | { kind: 'advance'; level: number }
  /**
   * Put a card up. It is told what to SAY and what its button DOES; it never
   * asks which level it is on, which is what keeps every branch of the story
   * in the one table below.
   */
  | {
      kind: 'card';
      title: string;
      buttonLabel: string;
      buttonAction: 'advance' | 'store';
      /** the level the button loads, when buttonAction is 'advance' */
      advanceTo: number | null;
      /** whether a separate store link sits under the button. Win card only —
       *  on the lose card the button already IS the store. */
      storeLink: boolean;
    };

const WIN_TITLE = 'YOU WIN!';
const LOSE_TITLE = 'YOU LOST';
/** the CTA wording, so the build says one thing in one voice */
const STORE_LABEL = 'PLAY NOW';

/** The card that ends the run. Both of beat two's outcomes land here. */
const terminalCard = (title: string): Outcome => ({
  kind: 'card',
  title,
  buttonLabel: STORE_LABEL,
  buttonAction: 'store',
  advanceTo: null,
  storeLink: false,
});

/**
 * What happens now that `level` has been cleared (or not). Pure — same input,
 * same answer, no reads of scene or director state.
 *
 * | where    | outcome | result                                  |
 * | -------- | ------- | --------------------------------------- |
 * | beat one | cleared | win card -> NEXT LEVEL -> beat two      |
 * | beat one | failed  | quiet restart of the board, NO card     |
 * | beat two | failed  | lose card -> store. Terminal.           |
 * | beat two | cleared | win card -> store. Terminal.            |
 */
export function outcomeFor(level: number, cleared: boolean): Outcome {
  const i = AD_SCRIPT.findIndex((b) => b.level === level);

  // Off-script. The dev level picker can jump to any board, and playtesting
  // level 4 should not drop an end card on it — so behave like the campaign
  // this grew out of: advance on a clear, retry on a fail, never show a card.
  if (i === -1) {
    if (!cleared) return { kind: 'restart' };
    const next = level + 1;
    return next < LEVELS.length ? { kind: 'advance', level: next } : { kind: 'restart' };
  }

  if (!cleared) {
    // beat one is not allowed to end the run — swap the board back in
    if (AD_SCRIPT[i]!.mustWin) return { kind: 'restart' };
    return terminalCard(LOSE_TITLE);
  }

  const next = AD_SCRIPT[i + 1];
  if (!next) {
    // Cleared the last beat. Unlikely by design, but an ad whose card can fail
    // to appear is a dead ad — so it still gets one, and the run still ends at
    // the store, exactly like the lose path.
    return terminalCard(WIN_TITLE);
  }

  return {
    kind: 'card',
    title: WIN_TITLE,
    buttonLabel: 'NEXT LEVEL',
    buttonAction: 'advance',
    advanceTo: next.level,
    storeLink: true,
  };
}
