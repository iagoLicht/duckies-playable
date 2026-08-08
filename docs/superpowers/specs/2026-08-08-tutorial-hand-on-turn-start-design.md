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
| after a turn ENDS, does the hand come straight back? | **no** (revised 2026-08-08) — it waits `SETTLE_GRACE` first. "Giving the player a short moment to decide what to do feels much more natural." The board's first gesture is exempt. |

## The change

`src/game/idleDemo.ts`, plus one line of `scene.ts` (see "spending the lesson"
below). `src/sim/demoShot.ts` and `Director.demoLaunch` are untouched.

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

### The settle grace (revised 2026-08-08)

"Immediately" turned out to be right for a board that has just opened and wrong
for a turn that has just ended. A hand reaching in the instant everything stops
reads as the game playing over the player; a beat to decide first is what makes
it read as a hint.

So `SETTLE_GRACE = 1.5 s` of a ready, untouched board before a gesture may start
— **except the board's first**, which still goes up at once, because a level
opening on a still board is the dead time this whole feature exists to kill. A
`firstOnBoard` flag, cleared on the first successful `start()` and set again by
`reset()`, is the whole mechanism. The grace runs on `idleFor`, so any pointer
event restarts it: a player still thinking with a finger on the glass keeps the
hand away.

The arithmetic, from the board coming to rest to the demo taking the shot: 1.5 s
grace + 0.45 s drag + 3.55 s hold ≈ **5.5 s**, against the 5.05 s the original
four-second-idle build took. Effectively unchanged pacing, with the middle four
seconds now showing a hand instead of nothing. `SETTLE_GRACE` is the knob if that
beat wants to be longer.

### The gesture

The gesture's shape is unchanged: fade in over the first 40 % of the drag,
`quadOut` so it settles onto the aim rather than stopping dead on it, `pressed`
while dragging, `raised` on release, 0.25 s fade out. The hold already works by
saturating the drag interpolation at `k = 1` and re-issuing `move(pullTo)` each
frame, so a longer hold needs no new code path — only a longer deadline.

## "First" is per run, not per level, and not per gesture

A `taught` flag on the instance, set when the lesson is spent:

- it fired — the lesson was delivered
- **or the player touched the screen** — someone reaching for the board has
  taught themselves, and does not need the game to take another shot for them

`reset()` (the level swap) deliberately does not clear it. One `IdleDemo`
instance survives the whole run, re-parented per board, so beat 2 does not
re-teach a viewer who has been playing since beat 1.

The flag gates one thing only — which release deadline `start()` picks — so the
board can never end up in a state where the hand behaves differently in any other
way.

### Spending the lesson: `takeOver()`, not `abort()`

`abort()` has three callers and they do not mean the same thing. A level swap and
an end card landing over a hand that is still reaching are the BOARD's reasons
for stopping; a touch is the PLAYER's. Only the last one spends the lesson — a
run whose first beat ends before the demonstration ever landed should still teach
on the second.

So the player's path gets its own name. `takeOver()` sets `taught` and then
aborts; `abort()` keeps its exact current behaviour and its other two callers.
The one line in `scene.ts` is the `pointerdown` handler calling `takeOver()`
instead — still the first thing it does, before any refusal can return.

`takeOver()` sets the flag whether or not a gesture was running, including during
the hand's 0.25 s fade: a touch is a touch.

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

The abort on `pointerdown` is untouched in everything but its name, including its
place on the first line of the handler: the touch that interrupts is still the
touch that grabs, and the `demoLaunch` flag is still cleared on the way out so a
demo's free pass cannot leak onto the player's shot.

## The handover bug: a fresh pull must not sweep in from the demo's aim

Found in review once the demo was holding an aim at the top of every turn.

`aimFacing` is the sling's DRAWN facing, carried to the raw aim by a spring so
that assist's step changes do not snap the art. Its own doc said it is "null
between grabs so a fresh pull starts pointing where it is aimed" — but the reset
was inferred, in `syncRings`, from `held === null`: nothing held last frame,
therefore the next grab is new.

The inference does not survive the handover. `takeOver()` cancels the demo's pull
and `begin()` starts the player's **inside a single `pointerdown`**, so `held`
goes straight from one duck to another and never passes through null. The
player's brand-new pull was then sprung in from whatever angle the demo had been
aiming at — measured at 24–29° to travel, ~250 ms of the duck's art rotating into
place before it would follow the finger. That is the hesitation at the start of a
drag.

Keying the reset on the held duck's id is **not** a fix, and the probe proves it:
the player often grabs the very duck the demo was holding, which is a new grab
that looks identical to the old one.

The fix is to stop guessing. `startAim()` — the counterpart to the existing
`endAim()` — clears the spring on the frame a grab BEGINS, called from the two
places a grab can begin: the `pointerdown` handler and the demo's `grab` host
callback. `syncRings` keeps its `held === null` clear as housekeeping; the
load-bearing reset is the event.

## The entrance bug: the pull-back recoil pinned by `spawn_enter`

The second thing a fast grab exposed, and the one that was actually visible: the
tutorial finger stretched the band but the duck did not go back with it. It sat
where it was for the whole pull and then slid to the band's edge a fifth of a
second after the finger had already stopped.

`T_SPAWN = 22` outranks the aim's `T_RING = 1`, and `spawn_enter` keys `master`
and `head*` — the very bones the recoil moves. `addDuck` queues
`addEmptyAnimation(T_SPAWN, 0.1, 0)` behind it precisely so it releases them, and
the constant's own comment already warned that a held one "would outrank and
freeze idle, jump, dance and the aim recoil".

What was missing is that **`boardReady()` waits for the 200 ms scale-in TICKER,
never for the animation**, and the animation runs longer. Under a four-second
idle delay the two never met. Grabbing the instant the board opens, they always
do. Measured across the demo's 450 ms drag: the recoil sat at 0 px throughout,
then rose 7.4 → 44.3 px in exact lockstep with the spawn entry's `mixTime`
0.02 → 0.10.

The fix is one line in `setRingMode`'s `aim` branch: `setEmptyAnimation(T_SPAWN, 0)`
before the aim animation is set. The aim owns `master` from that frame, so
nothing above it may still be keying that bone. What is lost is the tail of an
entrance pop on a duck somebody has just taken hold of.

This one was never demo-specific — a player grabbing a freshly respawned duck hit
the same pin, and the branch's cut of `SPAWN_SCALE_TIME` from 300 ms to 200 ms
had widened the window. Both paths go through `setRingMode`, so both are fixed.

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
  at once — the assertion that the dead time is gone
- the run's **first** shot fires at ~1.05 s and `movesLeft` is unchanged
- on the **next** turn the hand waits out the grace before reaching in, and then
  **launches nothing for another ~4 s** — the beat to decide and the player's
  window are both real
- a touch during either gesture aborts within a frame and the player's own grab
  lands, on the same touch
- a touch that aborts the lesson also consumes it: the following turn holds for
  4 s, not 1.05 s
- `movesLeft` is unchanged across every demo shot in the run

`shots/probe-drag-start.mjs` covers the handover bug, and its shape is the point:
grab a duck, then jump the pointer to a **fixed** pull in one move and hold it
there. The pull length is constant from that frame on, so anything still moving
afterwards is the view catching up rather than the input. Three cases — taking
the sling over on another duck, taking it over on the demo's OWN duck, and a
board with no demo at all as the control — must all behave identically: the drawn
facing starts AT the aim (0° to travel), and the art does not travel while the
pull is held still.

`shots/probe-demo-stretch.mjs` covers the entrance bug, sampling every frame of
the demo's own drag: the duck must be at the band's edge on the frame the finger
stops pulling (>30 px, was 0.4 px), and already travelling halfway through the
pull (>20 px — above the rig's own idle bob, which alone reaches ~14 px and would
pass a lower bar for the wrong reason). It prints track 22's state per frame,
which is what made the cause legible in the first place.
`shots/probe-demo-middrag.mjs` writes the matching screenshot.

`probe-drag-start.mjs`'s drift threshold is 12 px, which separates two things: the bug moved
the art 24–58 px, while the duck rig's own looping `idle` bob is ~6 px and shows
up on every board including the control. The second one is the duck breathing and
is meant to be there.

Two things the probe has to get right, both learned the hard way:

- **Time it in the page.** The lesson fires ~1.05 s after its grab and a
  Playwright round trip is a large fraction of that, so the stopwatches live in
  `addInitScript` — free-running watchers that stamp the run's first grab and
  first launch whether or not the probe was looking. A stopwatch driven from node
  measures the driver, not the game.
- **Map synthetic touches through `layers.board`, not the stage.** The pointer
  handler reads `getLocalPosition(layers.board)`, and the board layer is what
  carries the responsive fit — so the board's transform is the one to undo. The
  probe was mapping through the stage, which was the same thing before this
  branch added `layout.ts`/`stage.ts` and is not any more; every synthetic touch
  landed somewhere the ducks were not.

`shots/probe-idle-hold.mjs` still times its screenshot off the gesture (the pull
stops growing) rather than the wall clock, and keeps working unchanged — the hold
it waits for only got longer.

Note when running these: the dev server watches the project root, so writing
probe files or screenshots into `shots/` DURING a run triggers a Vite full-reload
and kills the page context mid-probe. Write first, then run.

## Revision, later the same day: the hand stops playing

**The automatic first shot is gone** (user-locked 2026-08-08). The hand drags,
aims, holds and then LETS GO WITHOUT FIRING, on a loop, for as long as nobody
plays. `cancel()` at the end of the gesture, never `end()` — the whole
difference between a hint and a move is that one of them takes the shot.

What this removes from the design above: the lesson/hint split, `LESSON_RELEASE_AT`,
`HINT_HOLD`, and the `taught` flag's role in choosing a release deadline.
`Director.demoLaunch` — the free-shot flag — is no longer set from anywhere. It
is deliberately LEFT IN the Director, with its tests: it is the mechanism if the
automatic shot is ever wanted back, and this feature has now changed direction
twice.

What survives unchanged: the hand arriving with the board rather than after a
wait, `SETTLE_GRACE` before any replay, `takeOver()` on the player's touch, the
`PROBE_RETRY` backoff, and both bug fixes (`startAim`, `setEmptyAnimation(T_SPAWN, 0)`).

`taught` becomes `played` and now sets the replay distance instead: a viewer who
has never touched the screen sees the gesture again after `SETTLE_GRACE` (1.5 s),
and one who has already shot is left alone for `REPLAY_DELAY` (3 s). Replaying a
hint 1.5 s into every pause for somebody who has demonstrably read it is nagging.

### The instruction line

One line of words across the top of the water: **"Drag a duck back, release to
shoot"**, in the bar's own label face, unboxed and at 0.92 alpha — a caption, not
a banner. The hand mimes the gesture and the line says it; neither does the job
alone, because a hand dragging a duck backwards is ambiguous about what the drag
DOES, and text on a board nobody has touched is wallpaper.

Placed at y 262, in open water. The tub's rim band runs ~190–216 and the first
row of ducks sits at y 350 with a 45 radius, so 240–300 is the clear channel
between them; an earlier pass at 218 put the letters straddling the rim's edge
and read as a caption stuck to the tub.

It shows on the same boards the hand does, and retires — a 0.4 s fade — the first
time the player actually fires. The hook is `endAim(id, fired)` with `fired`
true, which needs no test for whose shot it was: the hand always lets go with
`cancel()` and so always arrives there with `fired` false.

## Out of scope

The level-1 tap hand, `src/sim/demoShot.ts` and its choice of shot, the
`AD_SCRIPT`-only gate, the free-shot accounting in `Director`, level difficulty,
move budgets and pearl quotas are all untouched.
