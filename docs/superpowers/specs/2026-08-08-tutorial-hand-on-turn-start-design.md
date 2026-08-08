# Tutorial hand on turn start — the hint arrives before the dead time, not after it

**Date:** 2026-08-08
**Status:** approved, implementing
**Amends:** [2026-08-07 — Idle demo shot](2026-08-07-idle-demo-shot-design.md)

## The problem

The idle demo teaches the gesture, but it charges four seconds of silence for the
lesson. A viewer who does not already know the mechanic looks at a still board
for four seconds before anything tells them what to do, and this is a thirty
second playable — that is an eighth of the run spent teaching nothing, at the one
moment the viewer is most likely to leave.

The hand itself is right. Its timing is wrong: it arrives to rescue a viewer who
has already been stuck, when it should have been there before they could get
stuck at all.

## What we are building

The hand appears the instant the board is ready — every playable turn, not just
after a wait — sitting on the recommended move. The waiting moves inside the
gesture: the hand holds its aim through the seconds the viewer used to spend
looking at nothing.

Nothing about the gesture, the shot, the abort or the free-shot accounting
changes. Only when the hand shows up.

### Decisions (user, 2026-08-08)

| question | decision |
| --- | --- |
| when does the hand appear? | **the instant the board is ready**, on every playable turn |
| does the demo still fire the first shot? | **yes** — "the first shot will be by the tutorial, it will show the user how to play" |
| and on later turns? | the hand hints immediately, but the **release waits out today's four seconds**, so a player who has learned it takes their own shots |
| does a touch still hand the board straight back? | **yes, unchanged** — abort on the first line of `pointerdown` |

## The change

`src/game/idleDemo.ts`, and nothing else. `scene.ts`, `src/sim/demoShot.ts` and
`Director.demoLaunch` are untouched.

Today the hand's appearance and the shot are one welded timeline behind a single
delay:

```
board ready ──4s idle──> [ drag 0.45 │ hold 0.6 ] ──> fire
             ^^^^^^^^^^ dead time
```

The clock inverts. The gesture starts when the board is ready, and the HOLD — the
part that was always the readable part — absorbs the wait:

```
board ready ──> [ drag 0.45 │ hold ……………… ] ──> fire
                            ^^^^^^^^^^^^^ the wait, now with a hand in it
```

| | drag | hold | releases at |
| --- | --- | --- | --- |
| **the lesson** — first gesture of the run | 0.45 s | 0.60 s | **1.05 s**, as today |
| **every turn after** | 0.45 s | 3.55 s | **4.0 s** |

`IDLE_DELAY` does not disappear; it changes meaning, and its name should follow.
It is no longer a delay before the hand — it is `HINT_HOLD`, how long the hint
holds its aim before the demo takes the shot anyway. The viewer who never touches
the screen is therefore carried through the level at **exactly today's pace**.
They have not lost a demo shot or gained one; they have stopped spending the
first four seconds of each turn looking at a board that is not telling them
anything.

The gesture's shape is unchanged: fade in over the first 40 % of the drag,
`quadOut` so it settles onto the aim rather than stopping dead on it, `pressed`
while dragging, `raised` on release, 0.25 s fade out. The hold already works by
saturating the drag interpolation at `k = 1` and re-issuing `move(pullTo)` each
frame, so a longer hold needs no new code path — only a longer deadline.

## "First" is per run, not per level, and not per gesture

A `taught` flag on the instance, set when the first gesture ends **by any route**:

- it fired — the lesson was delivered
- **or the player's touch aborted it** — someone who grabs the duck mid-lesson
  has taught themselves, and does not need the game to take another shot for them

`reset()` (the level swap) deliberately does not clear it. One `IdleDemo`
instance survives the whole run, re-parented per board, so beat 2 does not
re-teach a viewer who has been playing since beat 1.

The flag gates one thing only — which release deadline `start()` picks — so the
board can never end up in a state where the hand behaves differently in any other
way.

## One clock, one rule

`idleFor` stops being a pre-gesture countdown and becomes the release clock. The
rule, whole:

> **the demo releases after N seconds with no pointer input**, N = 1.05 for the
> lesson, 4.0 for every hint after it.

`poke()` keeps exactly its current job — `pointermove` resets the clock — so a
viewer whose pointer is moving over the board extends the hold rather than having
a shot taken for them. This now applies to the lesson too, which is the intended
reading of one rule: a pointer already moving across the canvas is a viewer who
is engaging, and the lesson can wait for them.

The drag is animated off the gesture's own `t`, not off `idleFor`, so a poke
lengthens the hold without ever rewinding or stuttering the hand.

`pointerdown → abort()` is untouched, including its place on the first line of
the handler: the touch that interrupts is still the touch that grabs, and the
`demoLaunch` flag is still cleared on the way out so a demo's free pass cannot
leak onto the player's shot.

## Backoff on a refused start

`chooseDemoShot` scores every (shooter, target) pair of resting ducks and
validates each candidate through the real slingshot. Today a `null` result — no
legal shot, or the sling refused the grab — costs the four-second window before
it is asked again, which is what the existing comment means by "wait out another
window rather than asking every frame".

Starting immediately would turn that into a per-frame probe on any board with
nothing to show. So a refused start arms an explicit `PROBE_RETRY = 4` cooldown
before the next attempt. The answer cannot change while the board stays settled
and untouched, so nothing is lost by not asking.

## Consequences, named

These follow from the decision and are accepted, not overlooked:

- **The aim UI is up for most of every turn.** The aim line, the red X and the
  selection ring now sit on screen for roughly four seconds a turn instead of
  one. That is the point — a readable aim the viewer has time to parse — but it
  is a markedly more present board than today's.
- **`launchPull` plays at the top of every turn.** The demo's grab uses the
  player's own grab sound, by design; it now sounds once per turn rather than
  once per idle timeout.
- **The slingshot is held whenever the board is idle.** It already was during a
  demo; the window is simply longer. `abort()` cancels it inside the player's
  own `pointerdown`, before `boardReady()` is consulted, so this cannot refuse a
  grab.

## Testing

`IdleDemo` is Pixi-coupled and has no headless surface, so this is browser-probe
work. `shots/probe-idle-demo.mjs` grows to cover the new timing:

- on a fresh ad beat with **no touch at all**, the hand and a live aim line are up
  within ~0.6 s — the assertion that the dead time is gone
- the run's **first** shot fires at ~1.05 s and `movesLeft` is unchanged
- on the **next** turn the hand appears immediately again, but **nothing launches
  before ~4 s** — the player's window is real
- a touch during either gesture aborts within a frame and the player's own grab
  lands, on the same touch
- a touch that aborts the lesson also consumes it: the following turn holds for
  4 s, not 1.05 s
- `movesLeft` is unchanged across every demo shot in the run

`shots/probe-idle-hold.mjs` still times its screenshot off the gesture (the pull
stops growing) rather than the wall clock, and keeps working unchanged — the hold
it waits for only got longer.

Note when running these: the dev server watches the project root, so writing
probe files or screenshots into `shots/` DURING a run triggers a Vite full-reload
and kills the page context mid-probe. Write first, then run.

## Out of scope

The level-1 tap hand, `src/sim/demoShot.ts` and its choice of shot, the
`AD_SCRIPT`-only gate, the free-shot accounting in `Director`, level difficulty,
move budgets and pearl quotas are all untouched.
