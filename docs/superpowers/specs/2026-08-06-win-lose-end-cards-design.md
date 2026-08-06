# Design — win / lose end cards, and the ad script that reaches them

**Date:** 2026-08-06
**Branch:** `levels-clam-moves`
**Status:** awaiting review

Turns the ten-level campaign into a **two-beat playable ad**: one board the
viewer wins, one board the clock takes away from them, and a card at each end.
The first card sends them onward into the second board; the second card sends
them to the store and ends the run.

This closes the README's biggest shipping gap — *"No end card / CTA. Clearing
the last level just sits there."*

---

## 1. Decisions taken in conversation (2026-08-06)

| # | Decision |
| --- | --- |
| E1 | The ad is a scripted two-beat story, not a campaign run: win one board, lose the next. |
| E2 | **Losing is the clock running out**, and it is terminal — it ends the run and shows the lose card. |
| E3 | Beat one is **level 9 (The Gauntlet)**; beat two is **level 10 (The Golden Pearl)**. |
| E4 | The win card's button reads **NEXT LEVEL** and loads beat two. |
| E5 | The lose card is **terminal**: one button, it opens the store, and there is no way back into the game. |
| E5a | The win card also carries a **store link separate from its button**, since its button continues play rather than installing. |
| E6 | Art: `popup-body-tall` as a big square panel, `ribbon-banner` as the title plate, `btn-green-large` as the button. |
| E7 | Level 9 is made reliably winnable by dropping its **hp3 keystone barrel to hp2** — the "two stripes to one stripe" change. |
| E8 | Level 10 is made **provably unwinnable inside 30 s**, not merely unlikely. |

### 1.1 What this supersedes

`docs/superpowers/specs/2026-08-04-endcard-fail-audio-design.md` is overridden in
two places, deliberately:

- **D4** — *"Failing shows an 'OUT OF MOVES!' title and auto-retries — no tap
  required, no fail popup."* Reversed by E2: there is now a fail popup, it is
  terminal, and the trigger is time rather than moves.
- **§4** — the end card fires *"when `levelCleared` arrives with
  `index + 1 === LEVELS.length`"*. Reversed by E1/E3: the card fires on the ad
  script's beats, and level 10 is now reached by *losing forward*, not by
  clearing nine boards.

Everything else in that document — the `duckBumped` event, the audio mapping, the
all-Pixi rationale, the store URL — stands unchanged. Its §3 (persistent HUD CTA
and mute toggle) remains blocked on the superseded HUD-layout note and is **out
of scope here**.

The store URL is unchanged: `https://play.google.com/store/apps/details?id=com.candivore.duckies`.

---

## 2. The script

```
boot ──→ BEAT 1: level 9 ──cleared──→ [ YOU WIN! ]
              ↑                        button: NEXT LEVEL
              │                        link:   store
              │ (quiet restart on fail)      │
              │                              ↓
              └──────────────────────  BEAT 2: level 10
                                              │
                                        clock hits 0
                                              ↓
                                        [ YOU LOST ]
                                        button: PLAY NOW → store
                                        TERMINAL — no way back
```

### 2.1 Beat two always ends the run

The asymmetry is deliberate and is the whole shape of the ad. **Beat one is a
door** — you clear it and walk through to the next board. **Beat two is a wall** —
however it resolves, the run is over and the only thing left to do is install.

That gives the flow exactly three outcomes, and every one of them is handled:

| where | outcome | what happens |
| --- | --- | --- |
| beat one | cleared | win card → NEXT LEVEL → beat two |
| beat one | failed | **quiet restart of the board** — no card |
| beat two | failed (expected) | lose card → store. Terminal. |
| beat two | cleared (unlikely) | win card → store. Terminal. |

**Beat one cannot be lost.** If the clock expires or the budget is spent on
level 9, the board **quietly restarts** — the behaviour the game already has
(`scene.ts:1258`), minus the card. The lose card is reachable only from beat two.
E7 makes this path rare; the guard makes it invisible when it happens.

**Beat two can be won.** E8 makes that vanishingly unlikely, but "vanishingly" is
not "never", and an ad whose end card can fail to appear is a dead ad. If level
10 is cleared, the **win card** shows — but with no next level to advance to, its
button becomes the store CTA and the run ends there, exactly like the lose path.
One label-and-action swap, no third card, and no branch where the viewer is left
with nothing to tap.

### 2.2 Where the script lives

A new module, `src/game/flow.ts`, owns it:

```ts
export interface Beat { level: number; mustWin: boolean }
export const AD_SCRIPT: Beat[] = [
  { level: 8, mustWin: true },   // The Gauntlet — the viewer must clear this
  { level: 9, mustWin: false },  // The Golden Pearl — the clock takes it
];
```

`mustWin` is what drives §2.1's first guard, so the rule is stated once as data
rather than scattered as level-index comparisons through `scene.ts`. Adding,
reordering or reskinning beats is then a one-line edit.

`GameScene` asks `flow` what to do on `levelCleared` / `levelFailed` and gets
back a plain description of the next move:

```ts
type Outcome =
  | { kind: 'restart' }                       // beat one failed — no card
  | { kind: 'advance'; level: number }        // straight into the next beat
  | { kind: 'card'; title: string; buttonLabel: string;
      buttonAction: 'advance' | 'store'; storeLink: boolean };
```

The card is told *what to say and what its button does*; it never asks which
level it is on. That is what keeps the three outcomes of §2.1 in one readable
table in `flow.ts` instead of spread across `scene.ts` as index comparisons, and
it is why "beat two cleared" costs a label swap rather than a new code path.

The scene keeps owning pixels; the flow owns the story.

---

## 3. The clock becomes a rule, not a decoration

### 3.1 What it does today

`LEVEL_SECONDS = 30` (`scene.ts:416`) counts down in the **view**
(`tickTimer`, `scene.ts:850`) and its own doc comment admits the state of things:

> *"Display only: hitting zero stops the bar and leaves it empty, and nothing
> else happens — the level is still decided by moves alone."*

### 3.2 Why it moves into the sim

The README's own rule, learned the hard way on the move budget:

> **A limit enforced only in the view is not enforced.** The move budget was
> bypassable until the sim itself refused the shot.

A view-side clock is bypassable the same way, is invisible to the headless
tests, and cannot be asserted on. So the countdown becomes a **tick budget owned
by `Director`**:

- `SIM.LEVEL_TICKS = 30 * 60`, in `src/sim/config.ts` beside the other budgets.
- `Director` counts down in `step()` and emits the seconds remaining, exactly as
  it already emits `movesLeft`.
- The view's `clockTiles` render that number instead of their own float. The
  digit-roller animation, the red `TIMER_URGENT` ink under 10 s and the flip
  behaviour are untouched — only the source of the number changes.

**Consequence, and it is the right one:** hitstop freezes the sim
(`scene.ts:631`), so it now freezes the clock too. The player is no longer
charged for the game's own freeze frames.

### 3.3 When time-out bites

The clock reaching zero **blocks the slingshot immediately** but does not decide
the level until `boardSettled()` — the identical rule the move budget already
uses (`director.ts:147`), and for the identical reason stated there:

> *"the budget only bites once everything has settled — a shot in flight, a
> burning fuse or a drifting blast victim still gets to finish the job"*

So a chain in flight at 0:00 finishes and may still clear the board. This can
push a run a second or two past thirty; that is a cheaper price than snatching a
win out of a player's hands mid-chain, and it keeps one settle rule in the file
instead of two.

### 3.4 Two changes in `src/sim/types.ts`

A new event, shaped after `movesLeft`, so the view has a number to render and
the tests have something to assert on:

```ts
| { type: 'timeLeft'; seconds: number }
```

Emitted only when the whole-second value changes, not every tick — the digit
tiles only redraw on a change, and a 60 Hz event stream for a number that moves
30 times would be noise in every test that drains the queue.

And `levelFailed` grows a reason:

```ts
| { type: 'levelFailed'; index: number; reason: 'time' | 'moves' }
```

Both are additive, like `duckBumped` before them. Existing tests read events by
`.filter(e => e.type === ...)` and none asserts an exact event shape or a total
event count, so this breaks nothing — same reasoning, and the same grep, as the
earlier spec's §2.5.

---

## 4. The two boards

### 4.1 Beat one — level 9, made winnable

`levels.ts:459-470` describes The Gauntlet as the campaign's **designed
near-miss**: *"Budget intent: 6 goals / 11 hits in 8 shots... Cruellest
near-miss here. The staircase measured inside the length targets untouched — 8
is its p75."* p75 means roughly one run in four already fails it on moves alone,
before a clock exists. As the board the script requires the viewer to win, that
is the wrong tuning.

**The change (E7):** the hp3 keystone at (360, 900) drops to **hp2**.

Per `scene.ts:543-546` — *"hpN shows N-1 metal straps. 3 hp = two straps (hp3),
2 hp = one strap (hp2)"* — this is exactly the "barrel with two stripes becomes
one stripe" change, and level 9 has precisely one hp3 barrel, so the instruction
is unambiguous. Board hits fall **11 → 10**; the staircase geometry, the
generation-at-a-time chain lesson and the 0.35 assist are all untouched.

**This is a hypothesis, not a result.** Per the project's standing rule that
balance is measured and never guessed, the change is validated by re-running the
tuner with the 30 s clock applied, and reporting the clear rate. **If one hit is
not enough to make beat one reliable, the numbers come back to the user before
any further lever (move budget, assist) is touched** — the spec does not
pre-authorise a second change.

### 4.2 Beat two — level 10, made unwinnable in 30 s (E8)

Level 10 currently carries `pearls: 30` against `moves: 11`. Its comment is
stale — it still describes the pre-`4f9b6c1` six-pearl quota (*"Budget intent: 4
crates + 6 pearls in 5 shots"*, p50 4 shots) — so **the board's real difficulty
under a 30-pearl quota is unmeasured**, and "it is probably too slow" is not
what E8 asked for.

The quota is the lever, because it is bounded by *time*, not by skill: a pearl is
only counted when it lands on the HUD (`director.ts` — *"a pearl counts when it
LANDS on the counter"*), each clam costs `SIM.CLAM_SPILL_TICKS` (~0.57 s) per
open plus the pearl's flight, and there are three clams. That puts a hard ceiling
on pearls-per-second that no amount of aim can beat.

**Method:**

1. Measure the ceiling — a headless harness that plays level 10 with the budget
   and clock disabled and records the **fastest simulated time** to the quota
   across the standard seed count.
2. Set the quota so the fastest measured run lands **comfortably beyond 30 s**,
   with the margin stated as a multiple, not a vibe.
3. Record the number and its measured basis in the `levels.ts` comment, the way
   move budgets already cite their percentile.
4. Correct that comment's stale six-pearl prose while there.

A test then asserts the property directly (§7), so E8 is *enforced*, not merely
intended.

---

## 5. The cards

One component, two skins. `src/game/endCard.ts` — a new module, not more
`scene.ts`. That file is already 2492 lines and the card is a self-contained
thing with a narrow interface:

```ts
showEndCard(app, { title, buttonLabel, onButton }): void
```

### 5.1 Composition

Drawn in Pixi in the 720×1280 design space, bottom to top:

1. **Scrim** — dark translucent fill over the board, fading in. The board stays
   visible; the state you won or lost is the backdrop.
2. **Panel** — `popup-body-tall`, a **big square** (E6). See §5.2.
3. **Title plate** — `ribbon-banner` (1004×338) across the panel top, downscaled;
   the manifest flags it as the pack's heaviest UI asset.
4. **Title text** — **"YOU WIN!"** / **"YOU LOST"** in Cherry Bomb on the ribbon.
5. **Button** — `btn-green-large` (578×227), green on both cards. The art ships
   no baked label, so the text is drawn over it in Cherry Bomb.
6. **Store link** — small text beneath the button. **Win card only**; on the
   lose card the button already *is* the store, and a second path to the same
   place is noise.
7. **No close button**, carried forward from the earlier spec's D7.

### 5.1.1 What differs between the two

| | WIN card | LOSE card |
| --- | --- | --- |
| ribbon title | **YOU WIN!** | **YOU LOST** |
| button label | **NEXT LEVEL** | **PLAY NOW** |
| button action | load beat two | open the store |
| store link under it | yes | no — the button is the store |
| terminal? | no (except after beat two — §2.1) | **yes** |
| entrance sound | `pointWhoosh` | silent |

`PLAY NOW` is the label carried over from the earlier spec's §3.2 CTA, so the
build says one thing in one voice. It is a one-line change if a different word
tests better.

### 5.2 The panel's 9-slice insets must be measured, not read

`ui-manifest.json` gives `popup-body-tall` insets **L471 / R457 / T283 / B209**
against a 928×496 source. Those sum to 928 wide and 492 of 496 tall — the
stretchable middle is **0 px wide and 4 px tall**. Pixi's `NineSliceSprite`
cannot shrink that below the source width, and E6 asks for a square (taller and
narrower than 928×496). Taken literally, the manifest's numbers do not work.

So the insets are **re-measured off the art** — the rim thickness and the inner
well's rounded ends — and the panel is built with those. The manifest is
recorded as wrong for this use in the implementation notes rather than silently
worked around, since the project rule is to read the manifest before wiring an
asset and the next person will read the same wrong numbers.

Verification is the established one: render at 720×1280, classify pixel bands in
a screenshot, and confirm the corner arcs and rim thickness are **not** distorted
relative to the source. Eyeballing does not count.

### 5.3 Entrance

Scrim fades ~0.25 s; panel scales in with an overshoot settle; ribbon drops in
slightly behind it; button fades in last so the eye lands on it. Under ~1.0 s
total. Buttons are inert until the entrance completes, so nothing can be
tapped-through by accident.

`celebrate()` still plays underneath on the win beat; `lament()` still plays
under the lose beat. The cards sit on top of the existing feedback rather than
replacing it.

### 5.4 The store tap

`window.open(STORE_URL, '_blank')` from inside the Pixi pointer handler, which
runs synchronously inside the real user gesture, so popup blockers stay quiet.
This is the reason the cards are Pixi rather than a DOM overlay, carried forward
from the earlier spec's §4.3.

### 5.5 Why the button's label always matches its action

The win card's button continues play and says so; the lose card's button opens
the store and says so. A button reading "PLAY AGAIN" that silently opened the
store was considered and **rejected**: it is deceptive, and ad networks and app
stores reject playables for exactly that mismatch. Wherever the two cards differ,
they differ in the label as well as the action.

---

## 6. Audio

No new clips. Two existing mappings, per the earlier spec's §5.1 table:

| beat | sound |
| --- | --- |
| win card entrance | `pointWhoosh` (`win-whoosh`), on the panel beat |
| lose card entrance | **silent** |
| either card's button, and the win card's store link | `ui-click` |

The lose card's button plays `ui-click` and *then* opens the store. Since
`window.open` must run synchronously inside the gesture (§5.4), the sound is
fired first and the tab opened immediately after, in the same handler — not
sequenced behind a callback, which would move the `open` out of the gesture and
straight into a popup blocker.

The lose card is silent by the same reasoning already settled: the pack ships no
lose sting (`LoseTitle_Enter` is priority `nice` with no extracted clip), and
pitching another clip down would invent a sound the game does not have. The cold
`lament()` ring carries the beat.

This finally gives `ui-click` the button it has been waiting for — a standing
README open item (*"`ui-click` has no button to sit on yet"*).

---

## 7. Testing

**Sim (headless, `tests/sim/`):**

1. **Clock expires** — run a board with no shots fired; assert `levelFailed`
   arrives with `reason: 'time'` at 30 s of ticks, and not before.
2. **Clock blocks the slingshot** — assert no launch is accepted after zero.
3. **Settle rule** — with a chain in flight at 0:00, assert the level is not
   decided until `boardSettled()`, and that a clear landing in that window still
   emits `levelCleared` rather than `levelFailed`.
4. **Reason fidelity** — a board that runs out of *moves* still reports
   `reason: 'moves'`.
5. **Level 10 is unwinnable in 30 s (E8)** — across the standard seed count, with
   the clock applied, assert **zero** runs clear. This is the test that makes E8
   a property of the build rather than an intention.
6. **Level 9 is winnable in 30 s (E7)** — the same harness, asserting a clear
   rate above an agreed floor. The floor is set from §4.1's measurement, not
   invented here.
7. **Flow** — `flow.ts` unit tests, one per row of §2.1's outcome table: beat one
   cleared yields a card whose button advances; beat one failed yields
   `restart` and **never** a card; beat two failed yields the YOU LOST card with
   `buttonAction: 'store'`; beat two cleared yields the YOU WIN! card *also* with
   `buttonAction: 'store'`. Plus the property that matters most — **every
   outcome of beat two is terminal**, asserted directly rather than inferred from
   the four cases.
8. **Determinism** — unchanged: same seed, same event sequence.

**Existing gates that must stay green:** the full suite, the per-level
solvability gate, and the softlock guard. Note that levels 1–8 remain in
`LEVELS` and their tests keep running even though the ad does not visit them —
removing them is out of scope.

**View:** `npm run build && npm run shot` — the harness fails on console errors,
and both cards must appear in a capture. The panel-distortion check of §5.2 is
part of this.

**Build size:** the three UI textures add roughly 30 KB as WebP against a build
currently at ~1.13 MB of a 5 MB cap. No risk, but `npm run build` gates it
anyway.

---

## 8. Out of scope

- The persistent HUD CTA chip and mute toggle (earlier spec §3) — still blocked
  on the HUD-layout decision recorded there.
- Deleting or reordering levels 1–8. They stay in `LEVELS`, tested and reachable
  via `?level=N` in dev; the ad script simply does not visit them.
- Any second lever on level 9 beyond E7's hp change without returning to the
  user with measurements first (§4.1).
- Wiring `ssa-explosion`, `ptx-stars`, `dome`, `trail-noise-short` — untouched
  open items.
- Level 8's stale prose, and the level-schema gaps.

---

## 9. Build order

Each step is a commit on `levels-clam-moves`.

1. **Clock into the sim** — `SIM.LEVEL_TICKS`, `Director` countdown,
   `levelFailed.reason`, view reads the sim. Tests 1–4.
2. **Measure both boards** — level 9 with the hp2 keystone, level 10's
   pearl-quota ceiling. Report numbers; set level 10's quota. Tests 5–6.
3. **`flow.ts`** — the ad script and its state machine, wired into `GameScene`.
   Test 7.
4. **`endCard.ts`** — panel, ribbon, button, store link, entrance; insets
   measured and verified against a screenshot.
5. **Both cards wired to the flow**, audio mapped, `npm run shot` capture of
   each.
6. **README** — replace the "No end card / CTA", "No lose sting" and "Failing is
   silent" open items with what actually ships.
