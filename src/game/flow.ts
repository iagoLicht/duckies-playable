import { LEVELS } from '../sim/levels';

/**
 * The ad is a two-beat story, not a campaign run.
 *
 * Beat one is a ONE-WAY DOOR: clear it and walk through to the next board, miss
 * it and the run is over. Beat two is a WALL: however it resolves, the run is
 * over. So the only branch that continues the story is a win on beat one — the
 * viewer gets one attempt at each board and no attempt at either is ever
 * replayed (user-set 2026-08-07; beat one used to restart itself quietly).
 * That shape lives here as data rather than as level-index comparisons
 * scattered through scene.ts.
 *
 * No Pixi imports — this is decided headless and tested headless.
 */
export interface Beat {
  /** index into LEVELS */
  level: number;
  /**
   * The CTA wording on the card a FAIL here raises.
   *
   * The card itself is the same object in both cases — same art, same layout,
   * the same LOSE copy, same button opening STORE_URL — because a viewer who ran
   * out of board has exactly one thing left to do wherever it happened. Only
   * the wording differs: on beat one the impulse is to have another go, so the
   * button meets it with TRY AGAIN and answers it with the store, and beat two,
   * which was always the wall, keeps the plain PLAY NOW.
   */
  loseLabel: string;
}

export const AD_SCRIPT: Beat[] = [
  { level: 8, loseLabel: 'TRY AGAIN' },  // "9. The Gauntlet"      — the viewer clears this
  { level: 9, loseLabel: 'PLAY NOW' },   // "10. The Golden Pearl" — the clock takes it
];

/** Where the ad opens. */
export const FIRST_BEAT = AD_SCRIPT[0]!.level;

/**
 * The real Duckies Pop listing.
 *
 * The id is `com.candivore.ballblast`, which does not read like this game
 * because it is not from this game — Candivore shipped Duckies Pop under the
 * package of an earlier title and a store id can never be changed once
 * published. It looks like a copy-paste error and is not one; do not "fix" it.
 *
 * It replaces `com.candivore.duckies`, which was taken from the home-task brief
 * (that only asks the CTA "link anywhere") and was never a real listing — the
 * store answered it with "the requested URL was not found on this server".
 */
export const STORE_URL =
  'https://play.google.com/store/apps/details?id=com.candivore.ballblast';

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
      /** the quieter line under the banner — see CardCopy */
      subtitle: string;
      buttonLabel: string;
      buttonAction: 'advance' | 'store';
      /** the level the button loads, when buttonAction is 'advance' */
      advanceTo: number | null;
      /** whether a separate store link sits under the button. Win card only —
       *  on the lose card the button already IS the store. */
      storeLink: boolean;
    };

/**
 * A card's words. The banner SHOUTS the verdict and the line beneath it talks
 * to the player, which is why the subtitle is sentence case against the title's
 * caps and why the losing pair encourages rather than reports — "SO CLOSE!" is
 * a near miss you nearly had, where "YOU LOST" was a scoreboard.
 *
 * The two travel as ONE value rather than two arguments so a card can never be
 * built with a winning banner over a losing line.
 */
interface CardCopy {
  title: string;
  subtitle: string;
}

const WIN: CardCopy = { title: 'CONGRATULATIONS!', subtitle: 'You crushed it!' };
const LOSE: CardCopy = { title: 'SO CLOSE!', subtitle: "You'll get them next time!" };
/** the CTA wording, so the build says one thing in one voice */
const STORE_LABEL = 'PLAY NOW';

/**
 * The card that ends the run — every ending except a win on beat one.
 *
 * `buttonLabel` is the only thing any caller varies, and it never changes what
 * the button DOES: the card is terminal, so its button is the store whatever it
 * says on it.
 */
const terminalCard = (copy: CardCopy, buttonLabel = STORE_LABEL): Outcome => ({
  kind: 'card',
  title: copy.title,
  subtitle: copy.subtitle,
  buttonLabel,
  buttonAction: 'store',
  advanceTo: null,
  storeLink: false,
});

/**
 * What happens now that `level` has been cleared (or not). Pure — same input,
 * same answer, no reads of scene or director state.
 *
 * | where    | outcome | result                                   |
 * | -------- | ------- | ---------------------------------------- |
 * | beat one | cleared | win card -> NEXT LEVEL -> beat two       |
 * | beat one | failed  | lose card -> TRY AGAIN -> store. Terminal|
 * | beat two | failed  | lose card -> PLAY NOW  -> store. Terminal|
 * | beat two | cleared | win card  -> PLAY NOW  -> store. Terminal|
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

  // Every fail on-script is terminal, wherever it happened; the beat only
  // chooses the wording. NOTHING here restarts a board — see Beat.loseLabel.
  if (!cleared) return terminalCard(LOSE, AD_SCRIPT[i]!.loseLabel);

  const next = AD_SCRIPT[i + 1];
  if (!next) {
    // Cleared the last beat. Unlikely by design, but an ad whose card can fail
    // to appear is a dead ad — so it still gets one, and the run still ends at
    // the store, exactly like the lose path.
    return terminalCard(WIN);
  }

  return {
    kind: 'card',
    title: WIN.title,
    subtitle: WIN.subtitle,
    buttonLabel: 'NEXT LEVEL',
    buttonAction: 'advance',
    advanceTo: next.level,
    storeLink: true,
  };
}
