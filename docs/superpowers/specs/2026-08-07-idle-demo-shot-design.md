# Idle demo shot — the ad plays one shot for a viewer who isn't playing

**Date:** 2026-08-07
**Status:** approved, implementing

## The problem

This is a time-based playable ad. A viewer who does not understand the mechanic
sits there, the thirty-second clock runs out, and the run ends without a single
shot being fired. Nothing in the build currently teaches the gesture where it
matters: there is a `tutorial-hand` rig, but `scene.ts` shows it only on level
index 0 (`hand.visible = this.director.levelIndex === 0`), and the shipped ad
never opens level 1 — `AD_SCRIPT` runs levels 8 and 9. So the ad ships with no
hint at all.

## What we are building

When the board is genuinely waiting on the player and four seconds pass with no
input, the game performs one complete shot by itself — duck selected, sling
pulled back, aim held long enough to read, released. It repeats every four idle
seconds. Any touch stops it dead and hands control straight back.

The point is to demonstrate, not to play: the demo runs only on the ad's two
beats, and it costs the viewer nothing.

### Decisions (user, 2026-08-07)

| question | decision |
| --- | --- |
| does the demo shot spend a move? | **No.** "We are not counting moves, we are on a timer." The budget is untouched. |
| idle delay | **4 s**, repeating every 4 s for as long as the viewer stays idle |
| which shot | **a good one** — the same heuristic `tests/sim/bot.ts` uses: same-colour mate, or a line whose deflection carries into a surviving crate or oyster |
| which boards | **the ad's beats only** — `AD_SCRIPT`, i.e. levels 9 and 10 in the player's numbering |
| when may it start | **only when the board is fully settled and ready for input** — nothing moving, exploding, respawning or resolving a chain — and the four-second countdown does not begin until then |

## Architecture

Two units, split at the Pixi line.

### `src/sim/demoShot.ts` — pure, headless

```ts
export interface DemoShot { duck: Duck; pullTo: { x: number; y: number } }
export function chooseDemoShot(world: World, sling: Slingshot): DemoShot | null
```

Scores every (shooter, target) pair of resting ducks: +3 if the deflection line
carries into a surviving goal, +2 for a same-colour mate. No randomness — the
board changes after every shot, so a deterministic "best available" already
varies, and a deterministic chooser is one that can be tested.

The returned `pullTo` is the point the pointer must end up at: `PULL_LEN` (150)
behind the duck, opposite the shot, **shortened until the hand would sit clear
inside the water**. The clearance test is the sim's own `collideCircle` against
the tub, not a rectangle guessed at here — the tub has shoulders, rounded
corners and two bumper wedges, and one margin big enough to clear all of them
everywhere would forbid most of the board.

Pull length then breaks TIES, and only ties (`quality × 1000 + pullLen`): the
shot has to be worth watching first and easy to read second, but among shots
that are equally worth taking, a full 150px sweep teaches more than a 60px
twitch clipped by a nearby wall. This costs nothing in shot quality — one point
of quality outranks any pull.

Note the pull's LENGTH is not itself part of the lesson: in this game the drag
sets direction only, never power, so a shortened pull demonstrates exactly the
same shot.

**Every candidate is validated through the real slingshot before it is
returned**: `begin(duck) → move(pullTo) → preview()`, kept only if
`hitKind === 'duck'`, then `cancel()`. Aim assist bends the launch direction by
up to `ASSIST_CONE_DEG`, and `end()` refuses any release whose trajectory does
not reach a duck — so an angle chosen geometrically and released hopefully is
how you ship a demo that visibly whiffs. The dry run is safe because the board
is by definition idle when it is asked.

### `src/game/idleDemo.ts` — the driver

Owns the idle clock, the gesture timeline, and its own `tutorial-hand` instance.
It drives the real `Slingshot` with synthetic pointer positions, so the selection
ring, the aim line, the red X, the duck's `turn` facing, the `launchPull` sound
and the physics are the ones the player would get. Nothing about the shot is
simulated a second time.

Its own hand instance, not the level-1 tap hand: the two can never both want the
rig (the tap hand is level 0 only, the demo is ad beats only), and sharing one
`visible` flag between two features is the kind of implicit coupling that breaks
the next time either moves.

The rig's setup pose attaches `band`, `duck-ghost`, `split-a` and nine `dot`
slots — its own canned aim trail. Those are detached on the demo's instance: the
game draws the real aim line, and two trails would fight. What is left is
`hand`, `finger`, `shadow`, posed by `pressed` (0-length) while dragging and
`raised` on release. `pressed` keys nothing at all, so it cannot undo the bones
`raised` moved — the setup pose is re-laid first, and the canned slots stripped
again on top of it, because `setToSetupPose` re-attaches every one.

The rig's origin is its wrist, not its fingertip, and the fingertip is what a
touch contacts. Measured rather than guessed (`shots/probe-hand-origin.mjs`
parks the hand at a known design point and screenshots it): the tip sits at
origin + (9, −15), so the origin is offset by (−9, +15) from the pointer.

Host interface, kept to four members so the driver stays testable and `scene.ts`
does not grow another subsystem:

```ts
export interface IdleDemoHost {
  readonly director: Director;
  /** settled, whole, stocked and views built — GameScene.boardReady() */
  ready(): boolean;
  /** the view side of a grab: the launch-pull sound */
  grab(duckId: number): void;
  /** the view side of a release: rig snap-back if it fired, aim UI cleared */
  release(duckId: number, fired: boolean): void;
}
```

`release` is a refactor as well as an addition: the pointer-up handler in
`wireInput` already does exactly this work inline, and both paths will now call
the one method, so a player's release and the demo's release cannot drift.

## The gesture

| t (s) | what happens |
| --- | --- |
| 0.00 | hand fades in over the duck; `begin(duck.x, duck.y)` → selection ring, `launchPull` |
| 0.00–0.45 | hand slides from the duck to `pullTo`, `move()` each frame, `quadOut` so it decelerates into the hold; the aim line draws live |
| 0.45–1.05 | **hold** — 0.6 s of a stationary, readable aim line |
| 1.05 | `end()` → the shot fires; hand plays `raised` and fades over 0.25 s |

Total ≈ 1.3 s. The hold is the part that teaches; the drag alone is too quick to
read on a phone.

## Readiness — when the clock is allowed to run

The countdown only advances while `IdleDemoHost.ready()` is true, and it is
**reset to zero on any frame where it is not**. So a chain that takes two
seconds to unwind does not have the viewer's idle time counted against them, and
the demo cannot start on top of a board that is still resolving.

`ready()` is `GameScene.boardReady()` — which already exists and already answers
exactly this — plus two view conditions:

- `Director.readyForInput`: `boardSettled()` (nothing moving, no fuse burning, no
  pending pop, no pearl in the air, no clam open over one) **and** the field is
  back to its full duck count (so the ~0.6 s `RESPAWN_DELAY` after a chain is
  covered) **and** the slingshot is not blocked (budget, clock, outcome)
- `spawnQueue.length === 0 && spawning.size === 0`: a respawned duck is in
  `world.ducks` from the frame it spawns, but its view may still be queued or
  growing through `SPAWN_SCALE_TIME`
- plus, in the demo: no hitstop, no end card up, not already aiming, no active
  pointer, and `AD_SCRIPT` contains this level

An end card can also arrive *during* a gesture — the clock only bites once the
board has settled, which is exactly when a demo is allowed to run — so raising
one aborts the demo as well.

## Interruption

The idle clock resets on **any** pointer event. A **pointerdown** additionally
aborts a running gesture, on the first line of the handler before any other
work: `slingshot.cancel()`, hand hidden, aim UI cleared. The player's own grab
then proceeds normally inside that same event, so the touch that interrupts is
not swallowed.

The demo never sets `activePointer`, so it cannot block real input even if it
somehow got stuck mid-gesture.

## The free shot

`Director` gets one explicit flag, `demoLaunch`, set immediately before `end()`:

- `slingshot.onLaunch` skips its `pendingLaunches++` while it is set, so the
  budget is not even provisionally held against the viewer
- the `duckLaunched` drain skips the debit and clears the flag

Everything else — goals, pearls, chains, the win check, `duckLaunched` itself —
runs untouched. The Director is told *before* the launch rather than corrected
after, so the HUD's move counter never flickers down and back.

## Testing

**Headless** (`tests/sim/demoShot.test.ts`)
- on each ad board, across seeds, the chosen shot fires: driving `begin/move/end`
  with the returned `pullTo` returns `true` and emits `duckLaunched`
- returns `null` on a board with no legal shot
- prefers a same-colour mate and a goal-carrying line over a neutral one
- `pullTo` is on the stage and at least `MIN_PULL` from the duck

**Headless** (`tests/sim/director.test.ts`)
- `demoLaunch` leaves `movesLeft` unchanged while `duckLaunched` still fires and
  the shot still counts for goals; the flag clears itself after one launch

**Browser** (`shots/probe-idle-demo.mjs`)
- idle on an ad beat for 4 s → an aim line appears, a duck launches,
  `movesLeft` is unchanged
- a touch during the gesture aborts it within a frame and the player's own grab
  lands
- the countdown does not run while the board is unsettled: fire a shot, and the
  next demo is ≥ 4 s after the board comes to rest, not 4 s after the shot
- no demo at all on a board outside `AD_SCRIPT`

`shots/probe-idle-hold.mjs` writes a screenshot of the mid-hold frame — the one
the viewer is meant to read — timed off the gesture itself (the pull stops
growing) rather than off the wall clock, which drifts past the 0.6 s hold while
Playwright is still polling.

Note when running these: the dev server watches the project root, so writing
probe files or screenshots into `shots/` DURING a run triggers a Vite
full-reload and kills the page context mid-probe. Write first, then run.

## Out of scope

The level-1 tap hand is untouched. Level difficulty, move budgets and the pearl
quotas are untouched.
