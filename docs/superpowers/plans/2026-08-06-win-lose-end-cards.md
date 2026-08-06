# Win / Lose End Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the ten-level campaign into a two-beat playable ad — clear level 9, take a win card into level 10, lose level 10 to a real 30-second clock, and land on a terminal card whose button opens the store.

**Architecture:** The countdown moves out of the view and into `Director`, so it is a limit the sim enforces and the headless tests can assert on. A new pure module `src/game/flow.ts` owns the ad's script and answers "what happens now?" with a plain data outcome. A new view module `src/game/endCard.ts` draws the card from that outcome. `GameScene` keeps owning pixels and gains only wiring — it is already 2492 lines and must not absorb two more responsibilities.

**Tech Stack:** TypeScript, Pixi v8 (`NineSliceSprite`, `Text`, `Container`), Vitest for the headless sim, Playwright for the screenshot gate.

**Spec:** `docs/superpowers/specs/2026-08-06-win-lose-end-cards-design.md`

**Deferred at the user's request:** spec §4.2 / E8 — making level 10 *provably* unwinnable in 30 s. Level 10 ships as-is. The §2.1 safety net (clearing beat two shows the win card with a store button and still ends the run) means nothing breaks while this is outstanding. **Do not attempt it in this plan.**

---

## File Structure

| file | responsibility |
| --- | --- |
| `src/sim/config.ts` | *modify* — add `LEVEL_TICKS`, the countdown's length |
| `src/sim/types.ts` | *modify* — add `timeLeft` event; add `reason` to `levelFailed` |
| `src/sim/director.ts` | *modify* — own the countdown; fail on time; block the slingshot at zero |
| `src/game/flow.ts` | **create** — the ad script and the pure outcome function. No Pixi. |
| `src/game/endCard.ts` | **create** — the card's pixels: scrim, panel, ribbon, button, store link |
| `src/game/scene.ts` | *modify* — read the sim's clock; ask `flow` what to do; show the card |
| `src/main.ts` | *modify* — boot on the script's first beat, not level 0 |
| `scripts/prepare-assets.mjs` | *modify* — stage `btn-green-large.png` |
| `tests/sim/clock.test.ts` | **create** — the countdown is a real limit |
| `tests/sim/flow.test.ts` | **create** — one test per row of the spec's outcome table |

`flow.ts` holds no Pixi imports so it is unit-testable headless, exactly like `src/sim`.

---

## Task 1: The countdown becomes a sim constant and an event

**Files:**
- Modify: `src/sim/config.ts` (append to the `SIM` object, after `RESPAWN_DELAY`)
- Modify: `src/sim/types.ts:104` (beside `movesLeft`), `src/sim/types.ts:107` (`levelFailed`)

- [ ] **Step 1: Add the constant**

In `src/sim/config.ts`, immediately after the `RESPAWN_DELAY: 0.6,` line:

```ts
  /**
   * The board's countdown, in fixed steps — 30 s at 60 Hz. This lived in the
   * view as a decorative number until now; the README's own rule ("A limit
   * enforced only in the view is not enforced", learned on the move budget)
   * is why it is here instead. Hitstop freezes the sim, so it freezes the
   * clock too — the player is not charged for the game's own freeze frames.
   */
  LEVEL_TICKS: 30 * 60,
```

- [ ] **Step 2: Add the two type changes**

In `src/sim/types.ts`, replace the line `  | { type: 'movesLeft'; left: number }` with:

```ts
  | { type: 'movesLeft'; left: number }
  /** whole seconds left on the board's countdown; emitted only when it CHANGES,
   *  so draining the queue does not cost 60 events a second for a number that
   *  moves 30 times */
  | { type: 'timeLeft'; seconds: number }
```

Then replace `  | { type: 'levelFailed'; index: number }` with:

```ts
  /** `reason` is which limit actually bit. Both are checked at the same settle
   *  point, and time wins the tie — a board that runs out of both was out of
   *  time first, since the clock cannot be spent early the way moves can. */
  | { type: 'levelFailed'; index: number; reason: 'time' | 'moves' }
```

- [ ] **Step 3: Verify the compiler now fails where it should**

Run: `npx tsc --noEmit -p tsconfig.test.json`

Expected: FAIL. `src/sim/director.ts` pushes `levelFailed` without a `reason`, and `src/game/scene.ts` has a non-exhaustive switch. Both are fixed in Tasks 2 and 3. **Do not commit yet** — this step exists so you see the exact list of call sites you must touch.

---

## Task 2: `Director` owns the clock

**Files:**
- Modify: `src/sim/director.ts`
- Test: `tests/sim/clock.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/sim/clock.test.ts`:

```ts
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
  /** step until `stop` says so, collecting every event drained on the way */
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/sim/clock.test.ts`

Expected: FAIL — `d.secondsLeft` is not a property, and no `timeLeft` event is emitted.

- [ ] **Step 3: Add the countdown state**

In `src/sim/director.ts`, after the line `private pendingLaunches = 0;`, add:

```ts
  /** fixed steps left on the board's countdown — see SIM.LEVEL_TICKS */
  private ticksLeft = SIM.LEVEL_TICKS;
  /** the last whole second published, so `timeLeft` only fires on a change */
  private lastSeconds = -1;
```

Then, immediately after the `pearlCounter` getter, add:

```ts
  /** seconds left, rounded UP — the clock reads 00 only once time is truly gone */
  get secondsLeft(): number {
    return Math.ceil(this.ticksLeft * SIM.DT);
  }
```

- [ ] **Step 4: Block the slingshot at zero**

In `syncBlocked()`, replace the whole assignment with:

```ts
  /** the budget is spent when everything already fired has been paid for */
  private syncBlocked(): void {
    this.slingshot.blocked =
      this.movesLeft - this.pendingLaunches <= 0 ||
      this.ticksLeft <= 0 ||
      this.won ||
      this.failed;
  }
```

- [ ] **Step 5: Tick the clock and publish it**

In `step()`, insert this immediately after the `for (const e of evs) { ... }` loop closes and **before** the `// quota met` block:

```ts
    // the clock only runs while the level is live, so a decided board is not
    // left counting down behind a transition
    if (!this.won && !this.failed && this.ticksLeft > 0) {
      this.ticksLeft--;
      this.pushTimeLeft();
    }
```

Add the publisher beside `pushCounter` / `pushPearlCounter`:

```ts
  private pushTimeLeft(): void {
    const s = this.secondsLeft;
    if (s === this.lastSeconds) return;
    this.lastSeconds = s;
    this.pushLocal({ type: 'timeLeft', seconds: s });
  }
```

And in `start()`, after `this.pushLocal({ type: 'movesLeft', left: this.movesLeft });`:

```ts
    this.pushTimeLeft();
```

- [ ] **Step 6: Fail on either limit, at the same settle point**

Replace the existing fail block:

```ts
    // the budget only bites once everything has settled — a shot in flight, a
    // burning fuse or a drifting blast victim still gets to finish the job
    if (!this.won && !this.failed && this.movesLeft === 0 && goalsLeft && this.boardSettled()) {
      this.failed = true;
      this.pushLocal({ type: 'levelFailed', index: this.levelIndex });
    }
```

with:

```ts
    // Either limit only bites once everything has settled — a shot in flight, a
    // burning fuse or a drifting blast victim still gets to finish the job. The
    // clock bites the same way and for the same reason: it stops the NEXT shot
    // the instant it reaches zero (syncBlocked), but never snatches a board away
    // from a chain that is still resolving. That can push a run a second or two
    // past thirty, which is cheaper than robbing a player mid-chain.
    if (!this.won && !this.failed && goalsLeft && this.boardSettled()) {
      const outOfTime = this.ticksLeft <= 0;
      const outOfMoves = this.movesLeft === 0;
      if (outOfTime || outOfMoves) {
        this.failed = true;
        this.pushLocal({
          type: 'levelFailed',
          index: this.levelIndex,
          reason: outOfTime ? 'time' : 'moves',
        });
      }
    }
```

- [ ] **Step 7: Run the new tests**

Run: `npx vitest run tests/sim/clock.test.ts`

Expected: PASS, all six.

- [ ] **Step 8: Run the whole sim suite for regressions**

Run: `npx vitest run tests/sim`

Expected: PASS. Pay attention to `tests/sim/playthrough.test.ts` and `tests/sim/softlock.test.ts` — they drive long runs and are the two that could now hit a 30 s wall that did not exist before. **If either fails because a board ran out of clock, that is a real finding, not a broken test:** report it rather than raising `LEVEL_TICKS` to make it green. The likely correct fix is that those suites should construct their Director with the clock disabled, since they test board solvability rather than the ad's pacing.

- [ ] **Step 9: Commit**

```bash
git add src/sim/config.ts src/sim/types.ts src/sim/director.ts tests/sim/clock.test.ts
git commit -m "feat(sim): the 30s clock is a rule the sim enforces, not a HUD decoration

It counted down in the view and did nothing at zero. Now Director owns
it, blocks the slingshot the moment it expires, and fails the board at
the same settle point the move budget already uses — so a chain in
flight still gets to finish.

levelFailed carries which limit bit; timeLeft carries the number the HUD
draws, emitted per whole second rather than per tick.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: The view reads the sim's clock

**Files:**
- Modify: `src/game/scene.ts` — `LEVEL_SECONDS` (~:416), `timerLeft` field (~:656), `update()` (~:834), `tickTimer()` (~:850), `setTimer()` (~:2146), the event switch (~:1234)

- [ ] **Step 1: Derive the display constant from the sim**

Replace the `const LEVEL_SECONDS = 30;` line with:

```ts
/** what the tiles show on a fresh board. The sim owns the real limit
 *  (SIM.LEVEL_TICKS); this is only the number drawn before the first tick
 *  lands, and deriving it means the two can never disagree. */
const LEVEL_SECONDS = SIM.LEVEL_TICKS * SIM.DT;
```

- [ ] **Step 2: Delete the view-side countdown**

Remove the field:

```ts
  /** seconds left on the countdown */
  private timerLeft = LEVEL_SECONDS;
```

Remove the whole `tickTimer` method (its doc comment included — it says "Display only", which is no longer true), and remove the `this.tickTimer(dt);` call from `update()`.

- [ ] **Step 3: Make `setTimer` take a whole number**

Replace `setTimer` with:

```ts
  /** Draw a whole-second count on the two digit tiles. The value comes from the
   *  sim (`timeLeft`), which has already rounded it — the view does not keep a
   *  clock of its own any more. */
  private setTimer(seconds: number, snap = false): void {
    const n = Math.max(0, Math.min(99, Math.round(seconds)));
    const s = String(n).padStart(2, '0').slice(-2);
    const ink = n <= TIMER_URGENT ? TIMER_URGENT_INK : TILE_INK;
    for (const [i, t] of this.clockTiles.entries()) this.rollDigit(t, s[i]!, ink, snap);
  }
```

The two existing `this.setTimer(LEVEL_SECONDS, true)` calls (in `loadLevel` and the HUD build) stay exactly as they are.

- [ ] **Step 4: Handle the new event**

In the event switch, directly after the `case 'movesLeft':` block, add:

```ts
      case 'timeLeft':
        this.setTimer(e.seconds);
        break;
```

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit -p tsconfig.test.json`

Expected: PASS. If it still complains about `levelFailed`, you have missed nothing — the `reason` field is additive and the existing handler ignores it; that is fine until Task 6.

- [ ] **Step 6: See it in the real app**

Run: `npm run dev` and open the page. Watch the two clock tiles count 30 → 29 → 28. At 10 they must go red. Let it reach 00 and confirm the board refuses a new grab and then retries.

- [ ] **Step 7: Commit**

```bash
git add src/game/scene.ts
git commit -m "refactor(hud): the clock tiles draw the sim's countdown, not their own

The view no longer keeps a timer. It renders timeLeft, so the number on
screen and the limit that ends the level are the same number.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Level 9's keystone drops a stripe

**Files:**
- Modify: `src/sim/levels.ts:487` (the `{ x: 360, y: 900, hp: 3 }` barrel) and the level's comment block at `:459-470`

Per `scene.ts:543-546` — *"hpN shows N-1 metal straps. 3 hp = two straps (hp3), 2 hp = one strap (hp2)"* — the "two stripes to one stripe" change is `hp: 3` → `hp: 2`. Level 9 has exactly one hp3 barrel, so there is no ambiguity about which.

- [ ] **Step 1: Make the change**

In the `The Gauntlet` level, change:

```ts
      { x: 360, y: 900, hp: 3 },
```

to:

```ts
      { x: 360, y: 900, hp: 2 },
```

- [ ] **Step 2: Correct the level's comment**

The comment says *"Budget intent: 6 goals / 11 hits in 8 shots"* and *"Cruellest near-miss here."* Both are now wrong. Append to the comment block, immediately before the `{` that opens the level:

```ts
  // AD BUILD: the keystone dropped hp3 -> hp2 (two straps to one), so the board
  // is 6 goals / 10 hits, not 11. This is the ad's FIRST beat — the board the
  // viewer has to clear before the win card — so the campaign's cruellest
  // near-miss is exactly the wrong tuning for it. Geometry, the 0.35 assist and
  // the one-generation-at-a-time chain lesson are all untouched; only the
  // keystone's armour moved. See docs/superpowers/specs/2026-08-06-*.
```

- [ ] **Step 3: Measure what that actually bought**

Run: `node tests/tools/tune-levels.mjs --seeds=150 --level=9`

Record the printed percentiles. The pre-change budget was 8 shots at p75.

- [ ] **Step 4: Report, do not improvise**

Write the before/after percentiles into the level comment, the way every other budget in the file cites its measurement.

**The spec (§4.1) does not pre-authorise a second lever.** If the numbers say one hit is not enough to make beat one reliable inside 30 s, **stop and report the measurement to the user** rather than raising `moves` or `assist` on your own initiative. Note that the §2.1 safety net (a failed beat one quietly restarts) means the ad still works while this is being decided — it is a tuning question, not a blocker.

- [ ] **Step 5: Run the level gates**

Run: `npx vitest run tests/sim`

Expected: PASS, including the per-level solvability gate.

- [ ] **Step 6: Commit**

```bash
git add src/sim/levels.ts
git commit -m "balance(levels): the Gauntlet's keystone loses a strap for the ad's first beat

hp3 -> hp2 on the (360,900) keystone: 11 hits down to 10. This board is
now the board the viewer must CLEAR before the win card, and the
campaign's designed near-miss was the wrong tuning for that job.

Percentiles re-measured and recorded in the comment.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `flow.ts` — the ad's script

**Files:**
- Create: `src/game/flow.ts`
- Test: `tests/sim/flow.test.ts` (create — it lives with the other headless tests; `flow.ts` imports no Pixi)

- [ ] **Step 1: Write the failing test**

Create `tests/sim/flow.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AD_SCRIPT, outcomeFor } from '../../src/game/flow';
import { LEVELS } from '../../src/sim/levels';

/**
 * One test per row of the spec's outcome table (§2.1). The property that
 * matters most is the last one: beat two is a WALL — however it resolves, the
 * run ends at the store. An ad with a branch that leaves the viewer nothing to
 * tap is a dead ad.
 */
describe('the ad script', () => {
  const BEAT_1 = AD_SCRIPT[0]!.level;
  const BEAT_2 = AD_SCRIPT[1]!.level;

  it('points at two real levels', () => {
    expect(AD_SCRIPT).toHaveLength(2);
    for (const b of AD_SCRIPT) expect(LEVELS[b.level]).toBeDefined();
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
    const o = outcomeFor(BEAT_2, true);
    expect(o).toEqual({
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

  it('off-script levels keep the old campaign behaviour for the dev picker', () => {
    // level 0 is not in the ad, but ?level=1 must still be playable
    expect(outcomeFor(0, false)).toEqual({ kind: 'restart' });
    expect(outcomeFor(0, true)).toEqual({ kind: 'advance', level: 1 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/sim/flow.test.ts`

Expected: FAIL — cannot resolve `../../src/game/flow`.

- [ ] **Step 3: Write the module**

Create `src/game/flow.ts`:

```ts
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
   * beat quietly restarts the board instead of ending the run, so the ad's
   * first card is always the win.
   */
  mustWin: boolean;
}

export const AD_SCRIPT: Beat[] = [
  { level: 8, mustWin: true },   // 9. The Gauntlet — the viewer clears this
  { level: 9, mustWin: false },  // 10. The Golden Pearl — the clock takes it
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
  /** put a card up. It is told what to SAY and what its button DOES; it never
   *  asks which level it is on. */
  | {
      kind: 'card';
      title: string;
      buttonLabel: string;
      buttonAction: 'advance' | 'store';
      /** the level the button loads, when buttonAction is 'advance' */
      advanceTo: number | null;
      /** whether a separate store link sits under the button. Only the win
       *  card has one — on the lose card the button already IS the store. */
      storeLink: boolean;
    };

const WIN_TITLE = 'YOU WIN!';
const LOSE_TITLE = 'YOU LOST';
/** the CTA wording, matching the earlier spec's persistent-CTA chip so the
 *  build says one thing in one voice */
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
    // cleared the last beat. Unlikely, but an ad whose card can fail to appear
    // is a dead ad — so it still gets a card, and the run still ends at the
    // store, exactly like the lose path.
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
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/sim/flow.test.ts`

Expected: PASS, all seven.

- [ ] **Step 5: Commit**

```bash
git add src/game/flow.ts tests/sim/flow.test.ts
git commit -m "feat(flow): the ad's two-beat script as data, decided headless

Beat one is a door, beat two is a wall. outcomeFor() answers what
happens next with a plain object, so the card is told what to say and
what its button does rather than working it out from a level index.

Covers the branch nobody plans for: clearing beat two still ends the run
at the store, so no path leaves the viewer with nothing to tap.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Stage the button art

**Files:**
- Modify: `scripts/prepare-assets.mjs:62-65`

`popup-body-tall.webp` and `ribbon-pink.webp` are already staged (`icons/ribbon-pink.png` and `ui/ribbon-banner.png` are byte-identical — 24988 bytes — so the existing `src/assets/icons/ribbon-pink.webp` **is** the ribbon the spec asks for; do not stage it twice). Only the button is missing.

- [ ] **Step 1: Add the entry**

In the `WEBP` array, after the `{ src: 'ui/popup-body-tall.png', q: 75 },` line:

```js
  { src: 'ui/btn-green-large.png', q: 78 },                          // end-card CTA (578x227, no baked label)
```

- [ ] **Step 2: Stage it**

Run: `npm run assets`

- [ ] **Step 3: Verify it landed at the right size**

Run: `node -e "require('sharp')('src/assets/ui/btn-green-large.webp').metadata().then(m=>console.log(m.width,m.height))"`

Expected: `578 227` — the pack's dimensions, unresized. Anything else means the staging config resized it, which breaks the layout numbers in Task 7.

- [ ] **Step 4: Commit**

```bash
git add scripts/prepare-assets.mjs src/assets/ui/btn-green-large.webp
git commit -m "assets: stage btn-green-large for the end cards

The ribbon is already staged — icons/ribbon-pink.png and
ui/ribbon-banner.png are the same 24988 bytes, so ribbon-pink.webp is
the pack's ribbon-banner under the manifest's other name for it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Measure the panel's real slice insets

**Files:**
- Create: `C:\Users\licht\AppData\Local\Temp\claude\C--dev-duckies-playable\0e7b04c3-8eb2-495d-8fe0-10569f79c9ec\scratchpad\measure-panel.mjs` (throwaway — do not commit)

`ui-manifest.json` gives `popup-body-tall` insets **L471 / R457 / T283 / B209** on a 928×496 source. Those sum to 928 wide and 492 of 496 tall — a stretch band 0 px wide and 4 px tall. Pixi cannot shrink that below the source width, and the card needs a panel roughly 620 px wide in a 720 px design space. **The manifest's numbers are unusable here** and must be replaced with measured ones.

The technique that works: **3-slice vertically only.** Cut the texture at the row where the inner well is at its widest. Replicating that row makes the well grow taller with straight sides, which is exactly how a stadium shape should stretch. Horizontal size then comes from a uniform container scale, so nothing is ever squashed on one axis.

- [ ] **Step 1: Write the probe**

Create `measure-panel.mjs` in the scratchpad directory:

```js
// Finds the row where popup-body-tall's inner well is widest — the only row
// safe to replicate when stretching the panel vertically.
import sharp from 'sharp';

const SRC = 'src/assets/ui/popup-body-tall.webp';
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: C } = info;

// the well is the dark interior; the rim is the light orange around it
const isWell = (x, y) => {
  const i = (y * W + x) * C;
  const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
  return a > 200 && r < 140 && g < 90 && b < 90;
};

let best = { y: 0, span: -1, x0: 0, x1: 0 };
for (let y = 0; y < H; y++) {
  let x0 = -1, x1 = -1;
  for (let x = 0; x < W; x++) if (isWell(x, y)) { if (x0 < 0) x0 = x; x1 = x; }
  const span = x1 - x0;
  if (span > best.span) best = { y, span, x0, x1 };
}

console.log(`source        ${W}x${H}`);
console.log(`widest well   row y=${best.y}, x ${best.x0}..${best.x1} (span ${best.span})`);
console.log(`topHeight     ${best.y}`);
console.log(`bottomHeight  ${H - best.y - 1}`);
```

- [ ] **Step 2: Run it**

Run: `node "C:\Users\licht\AppData\Local\Temp\claude\C--dev-duckies-playable\0e7b04c3-8eb2-495d-8fe0-10569f79c9ec\scratchpad\measure-panel.mjs"`

Expected: a `topHeight` around 250-280 and a `bottomHeight` around 210-240, summing to roughly 495. **Write the actual printed numbers down** — Task 8 uses them verbatim.

Sanity check before continuing: `topHeight + bottomHeight` must be **less than** the source height (so a stretch band exists), and the widest-well span must be a large fraction of the width (~850+). If the span comes back tiny, the colour test missed the well — widen the `isWell` thresholds and re-run rather than guessing insets.

- [ ] **Step 3: No commit**

The probe is throwaway and lives in the scratchpad. Its *output* is what matters, and that gets baked into `endCard.ts` as named constants with a comment recording where they came from.

---

## Task 8: `endCard.ts` — the card's pixels

**Files:**
- Create: `src/game/endCard.ts`

Layout is in the fixed 720×1280 design space. The numbers below are starting values; Task 10 verifies them against a real capture and adjusts.

- [ ] **Step 1: Write the module**

Create `src/game/endCard.ts`. Replace `PANEL_SLICE_TOP` / `PANEL_SLICE_BOTTOM` with the numbers Task 7 printed:

```ts
import { Application, Container, Graphics, NineSliceSprite, Sprite, Text, Texture } from 'pixi.js';

import panelUrl from '../assets/ui/popup-body-tall.webp';
import ribbonUrl from '../assets/icons/ribbon-pink.webp';
import buttonUrl from '../assets/ui/btn-green-large.webp';

const DESIGN_W = 720;
const DESIGN_H = 1280;
const HUD_FONT = 'CherryBomb';

/** the pack's source dimensions, unresized by the staging step */
const PANEL_SRC_W = 928;
const PANEL_SRC_H = 496;
const RIBBON_SRC_W = 1004;
const BUTTON_SRC_W = 578;

/**
 * MEASURED, not read off the manifest.
 *
 * ui-manifest.json calls this a 9-slice at L471/R457/T283/B209, which sums to
 * the entire 928x496 texture — a stretch band 0px wide and 4px tall. Pixi
 * cannot shrink that below the source width, and this card needs a ~620px
 * panel in a 720px space, so those numbers are unusable here.
 *
 * Instead: 3-slice VERTICALLY (side insets 0), cutting at the row where the
 * inner well is widest, found by scripts in the scratchpad probe. Replicating
 * that row grows the well with straight sides, which is how a stadium shape
 * should stretch. Width comes from a uniform scale on the container, so
 * nothing is ever squashed on one axis only.
 */
const PANEL_SLICE_TOP = 0;    // <-- Task 7's topHeight
const PANEL_SLICE_BOTTOM = 0; // <-- Task 7's bottomHeight

/** panel geometry in design space */
const PANEL_W = 620;
const PANEL_H = 760;
const PANEL_CX = DESIGN_W / 2;
const PANEL_TOP = 260;

const RIBBON_W = 600;
const RIBBON_CY = PANEL_TOP + 46;
const TITLE_CY = RIBBON_CY - 12;

const BUTTON_W = 420;
const BUTTON_CY = PANEL_TOP + 610;
/** the button art carries a bottom bevel, so the label sits above centre */
const LABEL_DY = -10;
const STORE_CY = PANEL_TOP + 700;

const SCRIM_FADE = 0.25;
const PANEL_RISE = 0.45;
const BUTTON_FADE = 0.3;

export interface EndCardTextures {
  panel: Texture;
  ribbon: Texture;
  button: Texture;
}

export interface EndCardOpts {
  title: string;
  buttonLabel: string;
  /** a separate store link under the button — win card only */
  storeLink: boolean;
  onButton: () => void;
  onStore: () => void;
}

const loadTexture = async (url: string): Promise<Texture> => {
  const img = new Image();
  img.src = url;
  await img.decode();
  return Texture.from(img);
};

export async function loadEndCardTextures(): Promise<EndCardTextures> {
  return {
    panel: await loadTexture(panelUrl),
    ribbon: await loadTexture(ribbonUrl),
    button: await loadTexture(buttonUrl),
  };
}

/** ease used everywhere else in the view */
const quadOut = (t: number): number => 1 - (1 - t) * (1 - t);
/** overshoot settle — Back.easeOut, the same shape the duck spawn uses */
const backOut = (t: number): number => {
  const s = 1.70158;
  const u = t - 1;
  return u * u * ((s + 1) * u + s) + 1;
};

/**
 * The end card. Terminal or not is decided by the caller (see flow.ts) — this
 * only knows what to say and what to call when tapped.
 *
 * Returns the Container so the caller can remove it; it is added to the stage
 * on top of everything, and the board stays visible through the scrim because
 * the state you won or lost IS the backdrop.
 */
export function showEndCard(app: Application, tex: EndCardTextures, o: EndCardOpts): Container {
  const root = new Container();
  root.eventMode = 'static';
  app.stage.addChild(root);

  // ── scrim ────────────────────────────────────────────────────────────────
  const scrim = new Graphics().rect(0, 0, DESIGN_W, DESIGN_H).fill({ color: 0x0a1b28, alpha: 0.66 });
  scrim.alpha = 0;
  // swallows taps on the board underneath: the card is modal
  scrim.eventMode = 'static';
  root.addChild(scrim);

  // ── panel ────────────────────────────────────────────────────────────────
  // width/height are set in SOURCE units and the whole thing is then scaled
  // uniformly, so the rim keeps its aspect and only the middle band stretches
  const panelScale = PANEL_W / PANEL_SRC_W;
  const panel = new NineSliceSprite({
    texture: tex.panel,
    leftWidth: 0,
    rightWidth: 0,
    topHeight: PANEL_SLICE_TOP,
    bottomHeight: PANEL_SLICE_BOTTOM,
  });
  panel.width = PANEL_SRC_W;
  panel.height = PANEL_H / panelScale;
  panel.scale.set(panelScale);
  panel.position.set(PANEL_CX - PANEL_W / 2, PANEL_TOP);
  const panelBox = new Container();
  panelBox.addChild(panel);
  // pivot at the panel's own centre so the entrance scales about the middle
  panelBox.pivot.set(PANEL_CX, PANEL_TOP + PANEL_H / 2);
  panelBox.position.set(PANEL_CX, PANEL_TOP + PANEL_H / 2);
  root.addChild(panelBox);

  // ── ribbon + title ───────────────────────────────────────────────────────
  const ribbon = new Sprite(tex.ribbon);
  ribbon.anchor.set(0.5);
  ribbon.scale.set(RIBBON_W / RIBBON_SRC_W);
  ribbon.position.set(PANEL_CX, RIBBON_CY);

  const title = new Text({
    text: o.title,
    style: { fontFamily: HUD_FONT, fontSize: 78, fill: 0xffffff, align: 'center',
             stroke: { color: 0x7a2b46, width: 10, join: 'round' } },
  });
  title.anchor.set(0.5);
  title.position.set(PANEL_CX, TITLE_CY);

  const ribbonBox = new Container();
  ribbonBox.addChild(ribbon, title);
  ribbonBox.alpha = 0;
  root.addChild(ribbonBox);

  // ── button ───────────────────────────────────────────────────────────────
  const button = new Sprite(tex.button);
  button.anchor.set(0.5);
  button.scale.set(BUTTON_W / BUTTON_SRC_W);
  button.position.set(PANEL_CX, BUTTON_CY);

  const label = new Text({
    text: o.buttonLabel,
    style: { fontFamily: HUD_FONT, fontSize: 52, fill: 0xffffff, align: 'center',
             stroke: { color: 0x1c5c2d, width: 8, join: 'round' } },
  });
  label.anchor.set(0.5);
  label.position.set(PANEL_CX, BUTTON_CY + LABEL_DY);

  const buttonBox = new Container();
  buttonBox.addChild(button, label);
  buttonBox.alpha = 0;
  buttonBox.eventMode = 'static';
  buttonBox.cursor = 'pointer';
  root.addChild(buttonBox);

  // ── store link (win card only) ───────────────────────────────────────────
  let storeBox: Container | null = null;
  if (o.storeLink) {
    const link = new Text({
      text: 'Get Duckies Pop — free',
      style: { fontFamily: HUD_FONT, fontSize: 30, fill: 0xffffff, align: 'center' },
    });
    link.anchor.set(0.5);
    link.position.set(PANEL_CX, STORE_CY);
    const underline = new Graphics()
      .rect(PANEL_CX - link.width / 2, STORE_CY + link.height / 2, link.width, 3)
      .fill({ color: 0xffffff, alpha: 0.75 });
    storeBox = new Container();
    storeBox.addChild(link, underline);
    storeBox.alpha = 0;
    storeBox.eventMode = 'static';
    storeBox.cursor = 'pointer';
    root.addChild(storeBox);
  }

  // ── entrance ─────────────────────────────────────────────────────────────
  // Nothing is tappable until it finishes: a card that can be tapped through
  // while it is still flying in eats the viewer's first, most deliberate tap.
  buttonBox.eventMode = 'none';
  if (storeBox) storeBox.eventMode = 'none';

  let t = 0;
  const anim = (tk: { deltaMS: number }): void => {
    t += tk.deltaMS / 1000;
    scrim.alpha = 0.66 * Math.min(1, t / SCRIM_FADE);

    const p = Math.max(0, Math.min(1, (t - SCRIM_FADE) / PANEL_RISE));
    panelBox.scale.set(p <= 0 ? 0 : backOut(p));
    ribbonBox.alpha = quadOut(Math.max(0, Math.min(1, (t - SCRIM_FADE - 0.1) / 0.3)));

    const b = Math.max(0, Math.min(1, (t - SCRIM_FADE - PANEL_RISE) / BUTTON_FADE));
    buttonBox.alpha = b;
    if (storeBox) storeBox.alpha = b;

    if (t >= SCRIM_FADE + PANEL_RISE + BUTTON_FADE) {
      app.ticker.remove(anim);
      panelBox.scale.set(1);
      buttonBox.eventMode = 'static';
      if (storeBox) storeBox.eventMode = 'static';
    }
  };
  panelBox.scale.set(0);
  app.ticker.add(anim);

  buttonBox.on('pointertap', o.onButton);
  storeBox?.on('pointertap', o.onStore);

  return root;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.test.json`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/game/endCard.ts
git commit -m "feat(ui): the end card — panel, ribbon, button, store link

Panel insets are MEASURED, not taken from ui-manifest.json: its stated
9-slice for popup-body-tall sums to the whole texture, leaving a stretch
band 0px wide, which Pixi cannot shrink to the 620px this card needs.
3-slice vertically at the well's widest row instead, with a uniform
scale for width, so nothing is squashed on one axis.

Nothing is tappable until the entrance finishes.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Wire the flow and the cards into the scene

**Files:**
- Modify: `src/game/scene.ts` — imports, a field, `init()`, the `levelCleared` / `levelFailed` cases, `loadLevel`
- Modify: `src/main.ts:226-231`

- [ ] **Step 1: Import and hold the pieces**

At the top of `scene.ts`, beside the other local imports:

```ts
import { outcomeFor, STORE_URL, type Outcome } from './flow';
import { loadEndCardTextures, showEndCard, type EndCardTextures } from './endCard';
```

Add two fields beside `readonly audio = new Audio();`:

```ts
  /** end-card art, loaded once at boot alongside every other texture */
  private endCardTex!: EndCardTextures;
  /** the card currently up, if any — a second one must never stack on it */
  private endCard: Container | null = null;
```

In `init()`, beside the other `await loadTexture(...)` calls:

```ts
    this.endCardTex = await loadEndCardTextures();
```

- [ ] **Step 2: Add the one method that acts on an outcome**

Add this next to `loadLevel`:

```ts
  /**
   * Act on what the ad script decided. The scene does not know which level is
   * which beat, or whether an ending is terminal — flow.ts owns that, and this
   * only turns its answer into pixels.
   *
   * Bound to `dir`, the Director that produced the result: if the board is
   * swapped by hand (the dev level picker) before the delay elapses, a stale
   * decision must not yank the player off the level they just chose.
   */
  private applyOutcome(o: Outcome, delay: number, dir: Director): void {
    this.after(delay, () => {
      if (this.director !== dir) return;
      switch (o.kind) {
        case 'restart':
          this.loadLevel(dir.levelIndex);
          break;
        case 'advance':
          this.loadLevel(o.level);
          break;
        case 'card': {
          if (this.endCard) break; // never stack two cards
          const openStore = (): void => {
            // ui-click first, then open — window.open MUST run synchronously
            // inside the gesture or the popup blocker eats it
            this.audio.play('uiClick');
            window.open(STORE_URL, '_blank');
          };
          this.endCard = showEndCard(this.app, this.endCardTex, {
            title: o.title,
            buttonLabel: o.buttonLabel,
            storeLink: o.storeLink,
            onButton: () => {
              if (o.buttonAction === 'store') {
                openStore();
                return;
              }
              this.audio.play('uiClick');
              this.endCard?.destroy({ children: true });
              this.endCard = null;
              if (o.advanceTo !== null) this.loadLevel(o.advanceTo);
            },
            onStore: openStore,
          });
          break;
        }
      }
    });
  }
```

- [ ] **Step 3: Replace both event handlers**

Replace the whole `case 'levelCleared':` block with:

```ts
      case 'levelCleared': {
        console.log(`level ${e.index + 1} CLEARED with ${e.movesLeft} moves to spare`);
        this.celebrate();
        this.audio.play('pointWhoosh');
        this.applyOutcome(outcomeFor(e.index, true), LEVEL_ADVANCE_DELAY, this.director);
        break;
      }
```

Replace the whole `case 'levelFailed':` block with:

```ts
      case 'levelFailed': {
        console.log(`level ${e.index + 1} FAILED — out of ${e.reason}`);
        // DELIBERATELY SILENT. The event map lists LoseTitle_Enter but at
        // priority `nice`, and no fail clip was extracted from the bank — there
        // is no studio lose sting to play. Pitching some other clip down to fake
        // one would be inventing a sound the game does not have, so the cold
        // ring carries the beat on its own.
        this.lament();
        this.applyOutcome(outcomeFor(e.index, false), LEVEL_RETRY_DELAY, this.director);
        break;
      }
```

- [ ] **Step 4: Clear any card on a level swap**

At the very top of `loadLevel`, before `this.audio.stopAll();`:

```ts
    if (this.endCard) {
      this.endCard.destroy({ children: true });
      this.endCard = null;
    }
```

- [ ] **Step 5: Boot on the script's first beat**

In `src/main.ts`, replace:

```ts
  let startLevel = 0;
```

with:

```ts
  // the ad opens on its first beat, not on level 1 — see src/game/flow.ts
  let startLevel = FIRST_BEAT;
```

and add to the imports at the top of `main.ts`:

```ts
import { FIRST_BEAT } from './game/flow';
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.test.json`

Expected: PASS.

- [ ] **Step 7: Play it**

Run: `npm run dev`

Walk the whole script by hand:
1. It opens on **The Gauntlet**, not Bath Time.
2. Clear it → the **YOU WIN!** card rises, button reads **NEXT LEVEL**, a store link sits under it.
3. Tap NEXT LEVEL → **The Golden Pearl** loads and the clock restarts at 30.
4. Let the clock expire → the **YOU LOST** card rises, button reads **PLAY NOW**, and there is **no** store link under it.
5. Tap PLAY NOW → a store tab opens. The card stays up; nothing returns to the game.

Also check the failure the script depends on: deliberately lose **The Gauntlet** (sit still for 30 s). It must **restart the board with no card at all**.

- [ ] **Step 8: Commit**

```bash
git add src/game/scene.ts src/main.ts
git commit -m "feat(ad): wire the two-beat script and both end cards

The scene no longer decides what a cleared or failed board means — it
asks flow.ts and turns the answer into pixels. Opens on the script's
first beat rather than level 1.

Losing beat one restarts it silently; every ending of beat two puts up a
card whose button opens the store.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Prove it in a built file, and correct the README

**Files:**
- Modify: `README.md` — the *Open items* list and the *How the game works* section
- Uses: `tests/shot.mjs` via `npm run shot`

- [ ] **Step 1: Build and screenshot**

Run: `npm run build && npm run shot`

Expected: build passes the size gate, and the shot harness reports **no console errors**. A console error here is a hard failure, not a warning.

- [ ] **Step 2: Verify the panel is not distorted**

Capture both cards and inspect them. The pass condition, from the spec's §5.2:

- The panel's rounded corners are **circular arcs, not ovals** — the top and bottom caps must keep the source's aspect.
- The rim's thickness is the **same at the top and bottom** as it is at the sides.
- The ribbon does not overhang the panel's left or right edge.
- The button and the store link both sit inside the panel.
- Nothing overlaps the tub rim at `y=200` or runs off the 720×1280 frame.

Classify pixel bands from the capture rather than eyeballing it — that is the method this project already uses for HUD placement, and eyeballing is what the earlier spec explicitly ruled out.

If the panel *is* distorted, the likely cause is the Task 7 insets. Re-run the probe and check `PANEL_SLICE_TOP + PANEL_SLICE_BOTTOM < PANEL_H / panelScale`; if the target height is smaller than the two caps combined, Pixi has no band to stretch and falls back to squashing. Adjust `PANEL_H` upward or the insets inward, and say which you changed and why.

**If the well's cap arcs still look wrong after the insets are correct, stop and report with the screenshot.** The spec chose `popup-body-tall` on the user's explicit instruction; `popup-body.png` is the manifest's actual "end-card container" and is a 3-slice built for exactly this stretch. Swapping is the user's call, not yours.

- [ ] **Step 3: Adjust the layout numbers if the capture says so**

The constants at the top of `endCard.ts` (`PANEL_H`, `RIBBON_CY`, `BUTTON_CY`, `STORE_CY`) are starting values. Move them to match what the capture shows, and re-run `npm run shot` after each change.

- [ ] **Step 4: Correct the README**

In *Open items*, delete these three entries — all three now ship:

- *"**No end card / CTA.** Clearing the last level just sits there. Biggest gap for shipping as an actual ad."*
- *"**`ui-click` has no button to sit on yet.**"* — replace with a note that the mute toggle is still unwired, since that half is still true.
- *"**Failing is silent** — the board retries after 1.4 s with no 'out of moves' UI."*

Keep the *"No lose sting"* entry: the lose card is still deliberately silent and the reasoning is unchanged.

In *How the game works*, the **Levels** bullet currently says *"Clear → next level; fail → retry the same board."* Replace it with:

```markdown
- **Levels.** Cleared when every crate is destroyed and the pearl quota is met;
  failed when the **30-second clock** or the move budget is spent, goals remain,
  and the board is at rest (so a shot in flight always finishes its chain first).
- **The ad is two beats, not a campaign.** `src/game/flow.ts` scripts it: level 9
  is a door — clear it and the win card walks you into level 10 — and level 10 is
  a wall, where every ending puts up a card whose button opens the store. Losing
  level 9 quietly restarts it, so the first card a viewer sees is always the win.
  Levels 1-8 are still built and still tested; the ad just does not visit them.
```

Add to *Gotchas that will bite you*:

```markdown
- **`ui-manifest.json`'s slice insets for `popup-body-tall` cannot shrink it.**
  L471/R457/T283/B209 on a 928×496 source is the entire texture — a stretch band
  0 px wide. Pixi will not take it below 928 wide, and the end card needs 620.
  `endCard.ts` measures its own insets and 3-slices vertically instead.
```

- [ ] **Step 5: Full gate**

Run: `npm test`

Expected: PASS, including the per-level solvability gate.

- [ ] **Step 6: Commit**

```bash
git add README.md src/game/endCard.ts
git commit -m "docs: the README describes the two-beat ad, not the ten-level campaign

Closes three open items that now ship: the end card, the silent fail,
and ui-click having no button. Records the manifest's unusable slice
insets for popup-body-tall as a gotcha, since the next person will read
the same wrong numbers.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review notes

**Spec coverage.** §1 E1-E7 → Tasks 5, 9 (script and cards), Task 2 (clock), Task 4 (level 9), Tasks 6-8 (art). §2 → Task 5. §3 → Tasks 1-3. §4.1 → Task 4. **§4.2 / E8 is deliberately absent — deferred by the user.** §5 → Tasks 7-9. §6 audio → Task 9 (`uiClick` on both taps, `pointWhoosh` already fires on `levelCleared`, lose stays silent). §7 tests 1-4, 7 → Tasks 2 and 5. **§7 tests 5-6 (level 10 unwinnable, level 9 win rate) are not built:** test 5 belongs to the deferred E8, and test 6's floor depends on Task 4's measurement, which returns to the user before any threshold is fixed. §8 out-of-scope respected — the HUD CTA chip and mute toggle are untouched.

**Corrections made during execution.** Task 2's test list as written omitted the spec's §7 test 3 — the settle window — which is the subtlest behaviour in the whole change: an implementation that fails the board the instant the clock hits zero passed every test this plan originally specified. It also let through a tautological slingshot-blocking test, green even with the clock clause deleted from `syncBlocked()`. Both were caught in review and added. A plan that specifies tests must specify the ones that can *fail*, not only the ones that describe the happy path.

**Known gap, stated rather than hidden.** No automated test asserts the ad's *end-to-end* path (boot → clear → card → tap → level 10 → expire → card). Task 9 Step 7 walks it by hand and Task 10 captures both cards. A Playwright script driving `window.__scene` could automate it; that is worth doing but is a separate change, and pretending a manual walkthrough is a regression test would be worse than naming it.

**Type consistency.** `Outcome` is defined once in `flow.ts` and consumed in `scene.ts`; `outcomeFor(level, cleared)` has one signature throughout; `EndCardTextures` / `EndCardOpts` are defined in `endCard.ts` and imported by name. `setTimer(seconds, snap)` keeps its arity, so its two existing call sites are untouched. `SIM.LEVEL_TICKS` is the single source for the countdown's length, and the view's `LEVEL_SECONDS` derives from it.
