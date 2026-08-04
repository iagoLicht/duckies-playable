# Design — end card, fail UI, audio, and the missing duck-contact event

**Date:** 2026-08-04
**Branch:** `levels-clam-moves`
**Status:** awaiting review

Closes the shipping gaps in the ten-level campaign so the build reads as an
actual playable ad rather than a game demo. Scope is *polish the existing ten* —
no new levels, no level-schema work.

---

## 1. Decisions taken before this document

Confirmed in conversation on 2026-08-04:

| # | Decision |
| --- | --- |
| D1 | The campaign branch becomes the new repo's `main`. The asset pack stays **external** to the repo. |
| D2 | Scope is polishing the existing ten levels, not adding a second set. |
| D3 | A small **persistent** "Play Now" CTA in the HUD from level 1, plus the full end card only after level 10. The CTA must stay unobtrusive during gameplay. |
| D4 | Failing shows an "OUT OF MOVES!" title and **auto-retries** — no tap required, no fail popup. |
| D5 | A mute toggle lives in the HUD, placed **opposite** the CTA. |
| D6 | The duck-duck collision gets a **first-class sim event**. Binding the sound to `wallHit` was explicitly rejected. |
| D7 | The end card has **no close button**. It is terminal; Play Now is the only action. |

The CTA target is `https://play.google.com/store/apps/details?id=com.candivore.duckies`,
taken from the home-task brief, which requires "an end card with a *Play Now*
button (it can link anywhere)".

---

## 2. `duckBumped` — the missing sim event

### 2.1 Why it is missing

`collideDuckPairs()` (`src/sim/world.ts:219`) resolves duck-duck collisions
correctly — separation, then the equal-mass impulse — and then calls
`onDuckContact(a, b, |rel|)` at line 241. That hook was introduced in
`docs/plans/2026-08-02-phase-b-simulation.md:683` as a deliberately empty
virtual seam:

```ts
protected onDuckContact(_a: Duck, _b: Duck, _relSpeed: number): void {}
```

with the note *"the seam exists so Task 3 tests stay green while the file
grows."* Task 4 filled it with match-detection logic only:

```ts
protected onDuckContact(a: Duck, b: Duck, relSpeed: number): void {
  if (a.colour !== b.colour) return;
  if (!a.live && !b.live) return;
  if (relSpeed < SIM.POP_SPEED) return;
  this.flagMatched(a);
  this.flagMatched(b);
}
```

The seam was scaffolded as *"where matching happens"*, and reporting the contact
itself was never assigned to anyone. The result is an asymmetry: every other
collision routine in the file emits a contact event — `collideWalls` → `wallHit`,
`collideDuckClams` → `bumperHit`, `collideDuckBarrels` → `barrelDamaged` — and
**duck-pairs is the only one that reports nothing**. The most common interaction
in the game is invisible to the view unless it happens to produce a match.

### 2.2 The change

New variant in `src/sim/types.ts`, shaped after `wallHit` (which also carries
pre-impulse `speed`):

```ts
| { type: 'duckBumped'; a: number; b: number; x: number; y: number; speed: number }
```

Emitted in `collideDuckPairs`, after the impulse and **before**
`onDuckContact`, so the ordering is exactly: `duckLaunched` → `duckBumped` →
(if colours match and fast enough) `duckMatched` → fuse → `duckPopped` →
`blast` → chain.

```ts
if (rel < 0 && -rel >= SIM.BUMP_MIN_SPEED) {
  this.events.push({
    type: 'duckBumped', a: a.id, b: b.id,
    x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, speed: -rel,
  });
}
this.onDuckContact(a, b, Math.abs(rel));
```

`a`/`b` are ids in collision order; `x`/`y` are the contact midpoint; `speed` is
the pre-bounce relative approach speed, so the view can scale volume, pitch and
fx size by impact force.

### 2.3 Substep spam, and why this needs no cooldown state

`step()` runs 2–16 adaptive substeps and calls `onDuckContact` *unconditionally*
whenever two bodies overlap — the `POP_SPEED` gate inside is the only reason
that is cheap today. A naive emit at the same point fires for every resting pair
on every substep: roughly 960 events/second per touching pair in a settled
cluster.

The barrel path already solves this with explicit state (`world.ts:283`,
`hitCooldown` + `BARREL_HIT_COOLDOWN_TICKS`, commented *"the cooldown keeps one
physical collision from counting twice across substeps or contact jitter"*).

Duck pairs do **not** need that, because the impulse is self-debouncing. The
impulse only runs when `rel < 0`, and it sets `rel_new = -RESTITUTION_BODY ·
rel_old`, which is positive — the pair is separating, so the next substep cannot
re-fire. Gating the emit on the same `rel < 0` condition inherits that property
for free. A third body shoving the pair back together produces `rel < 0` again,
which is a genuinely new collision and *should* re-fire.

`BUMP_MIN_SPEED` then only has to reject contact jitter in settled clusters.

**This is the load-bearing assumption of the whole section, so it is asserted,
not trusted** — see the spam test in §7.

### 2.4 `BUMP_MIN_SPEED` is measured, not chosen

Per the project rule that balance is measured and never guessed, the threshold
is derived, not picked:

1. Instrument the bot harness (`tests/sim/bot.ts`) to record `|rel|` for every
   duck-duck contact across all ten levels at the standard seed count.
2. Histogram the result. Idle-jitter contacts and real collisions are expected
   to separate into distinct bands.
3. Set `SIM.BUMP_MIN_SPEED` in the trough between them.
4. Record the value **and its percentile** in the `src/sim/config.ts` comment,
   the same way move budgets cite their percentile, so the number is
   reproducible.

If the histogram shows no clean trough, that is a real finding: fall back to the
barrel pattern (per-pair cooldown keyed on the id pair) and say so, rather than
forcing a threshold that does not exist.

### 2.5 Blast radius of the change

Physics is untouched — pushing an event changes no state — so all 211 tests and
every measured move budget remain valid. Every existing test reads events via
`.filter(e => e.type === X)` or `.find(...)`; none asserts a total event count or
an exact sequence, so a new variant is purely additive. This was verified by
grep across `tests/` before writing this document.

---

## 3. Persistent CTA and mute toggle

### 3.1 Layout constraint

The HUD strip is everything above the tub rim at `y=200`; `HUD_ROW_Y = 112`.
Measured occupancy of that row today:

- moves plate: `MOVES_X = 360`, 291×116 at scale 0.72 → spans **x 255–465**
- goal plate: `GOAL_X = 566`, 291×116 at scale 0.50 → spans **x 493–639**

Free: **x 0–255** on the left, **x 639–720** on the right.

So the two new elements bookend the row: **CTA on the left, mute on the right**,
which satisfies "opposite the CTA" (D5) and keeps both clear of the playfield.
The right pocket is only 81px wide, which the toggle fits at reduced scale but
the CTA would not — this is why the CTA takes the left side.

### 3.2 CTA chip

- Art: `cta-green.png` (`cta-green-small-3slice`, 112×112, 3-slice caps L28/R26),
  rendered with Pixi v8 `NineSliceSprite`, stretched to fit the label.
- Label: "PLAY NOW" in Cherry Bomb, matching the existing HUD type.
- **Static.** No pulse, no shine, no attract animation — D3 requires it not
  compete with gameplay. It is legible and permanent, and that is all.
- Tap → `ui-click` sfx → opens the store URL in a new tab.
- Present from level 1, hidden while the end card is up (the end card carries
  its own, larger CTA).

### 3.3 Mute toggle

- Art: `toggle-on.png` / `toggle-off.png` (215×130), sprite swap on tap.
- Starts **on**: the brief grades "Feel: is it fun and responsive? Nice juice
  (motion, sound)", and a playable that opens silent throws that away. The
  toggle exists so a viewer in public can silence it, not as a default state.
- Drives the master `GainNode` (§5.2), not individual clips.
- Tap → `ui-click` sfx (audible on the un-mute transition only).

### 3.4 Exact positions

Final `x`/scale for both are set during implementation against a 412×915
screenshot using the established verification method — classify pixel colours
and print bands rather than eyeballing — with the pass condition that neither
element's bounding box intersects the moves plate (255–465), the goal plate
(493–639), or the tub rim (`y < 200`). The design fixes the *regions*; the
implementation fixes the pixels and shows the evidence.

---

## 4. End card

Fires when `levelCleared` arrives with `index + 1 === LEVELS.length` (i.e. after
level 10). `scene.ts:674` already branches on exactly this condition and
currently does nothing in the else case.

### 4.1 Composition

All Pixi, in the fixed 720×1280 design space:

1. **Scrim** — dark translucent fill over the whole board, fading in. The board
   stays visible underneath; the final cleared state is the trophy.
2. **Panel** — `popup-body.png` via `NineSliceSprite` (3-slice vertical: top cap
   131px, bottom cap 165px), stretched to the content height. The ui-manifest
   calls this *"The end-card container"*.
3. **Title** — `ribbon-banner.png` (1004×338, downscaled; the manifest flags it
   as the heaviest UI asset) across the panel top, reading **"YOU WIN!"**.
4. **Stat well** — `panel-inset.png` (9-slice, *"a text/score field behind copy
   on the end-card"*) showing `10 / 10 LEVELS CLEARED`.
5. **CTA** — `btn-play-hero.png` (530×250), already staged. The ui-manifest calls
   it *"the strongest single-image CTA for the end-card install prompt"*.
   Full-width, unmissable, the only interactive element.
6. **No close button** (D7).

### 4.2 Entrance

Scrim fades over ~0.25 s; panel scales in with an overshoot settle; ribbon drops
in slightly behind the panel; CTA fades in last so the eye lands on it. Total
under ~1.0 s. `win-whoosh` fires on the panel beat.

The existing `celebrate()` star wash still plays underneath on the final level —
it is the payoff for the last board and should not be swallowed by the card.

### 4.3 Click behaviour

`window.open(STORE_URL, '_blank')` from inside the Pixi pointer handler. That
runs synchronously within a real user gesture, so popup blockers stay quiet — the
main reason for choosing an all-Pixi UI over a DOM overlay was *not* losing this,
and it holds because Pixi's pointer events are dispatched from the native event.

---

## 5. Audio

### 5.1 Clip mapping

Twelve clips are already staged in `src/assets/sfx/clips/` (80.1 KB total).
Per `sfx-event-map.json`, these are the studio's own sounds, extracted from
ballblast's `inGame-audio.bank` — not substitutes.

| clip | trigger |
| --- | --- |
| `launch-pull` | aim grab — **view-side**, no sim event exists or is needed |
| `launch-release` | `duckLaunched` |
| `duck-bump` | **`duckBumped`** (§2) — the signature bounce tick |
| `match-collision` | `duckMatched` |
| `duck-explode` | `duckPopped` |
| `spawn-sploosh` | `duckStopped` |
| `candy-hit` | `barrelDamaged` |
| `candy-smash` | `barrelDestroyed` |
| `merge-done` | `clamOpened` |
| `win-whoosh` | `levelCleared` and the end-card entrance |
| `ui-click` | CTA tap, mute tap |
| `merge-swirl` | **unused** — we have no merge mechanic; forcing it would be dishonest |

`bumperHit` reuses `duck-bump` at reduced gain — the pack ships no pinball ping,
and the event map's `Bumper_Hit` entry is priority `nice` with no extracted clip.

**There is no lose sting in the pack.** `LoseTitle_Enter` is listed in the event
map but priority `nice`, and no fail clip was extracted. The "OUT OF MOVES!"
beat is therefore **deliberately silent** — the cold ring carries it. Faking one
with a pitched-down clip that is not the studio's sound was considered and
rejected.

### 5.2 Implementation

New module `src/game/audio.ts`. Web Audio, not `HTMLAudioElement`, because
`duck-bump` fires often and overlapping playback on pooled audio elements is
unreliable.

- One `AudioContext`, created lazily.
- All twelve clips `decodeAudioData`'d once at boot into `AudioBuffer`s.
- Master `GainNode` → destination. The mute toggle sets its gain to 0 or 1.
- `play(name, { gain, rate })` creates a `BufferSourceNode` per shot. No pooling
  needed; the node is fire-and-forget.
- **Unlock:** browsers suspend the context until a gesture. `ctx.resume()` is
  called on the first `pointerdown` anywhere on the canvas — which in this game
  is the first aim grab, so the first audible sound is `launch-pull` and nothing
  is lost.
- **Voice limiting:** per-clip minimum re-trigger interval (`duck-bump` is the
  one that needs it) and a cap on concurrent voices per clip, so a large chain
  cannot produce a wall of noise.
- **Pitch variation:** `playbackRate` jittered per shot for `duck-bump` and
  `duck-explode`, as the event map specifies (*"pitch-varied"*).

The scene calls `audio.play(...)` from the existing `SimEvent` switch. No new
coupling: audio reads events, exactly like the fx do.

### 5.3 Build size

Current build is 0.99 MB against a 5 MB cap. The clips add 80 KB raw (~107 KB
base64), plus roughly 60 KB for the newly staged UI art as WebP. Expected total
well under 1.2 MB — no cap risk.

**Risk:** the mp3s must actually inline into the single-file build. If Vite's
`assetsInlineLimit` does not catch them, the fallback is an explicit base64
import in the inline step. This is verified in the plan's first audio task, not
assumed at the end.

---

## 6. VFX — the README's open item is wrong

The README lists `dome`, `ptx-stars`, `ssa-explosion`, `curve` and
`trail-noise-short` as *"intended for the win celebration and shot trails."*
`asset-manifest.json` disagrees for four of the five:

| asset | manifest priority | manifest purpose |
| --- | --- | --- |
| `curve` | **core** | *"Soft curved spark/streak wisp for **collision sprays**"* |
| `ssa-explosion` | **core** | *"Compact explosion flipbook (156×156) — **main pop/burst animation**"* |
| `ptx-stars` | **core** | *"Multi-star confetti sheet — twinkle sparkle **on pop**"* |
| `dome` | nice | *"Scale-up shockwave ring **on impact**"* |
| `trail-noise-short` | **core** | *"motion trails behind launched ducks"* — the only one the README got right |

These are **in-gameplay impact juice, not celebration VFX**. Notably `curve` —
"collision sprays" — is the missing duck-duck contact *visual*, absent for the
same reason the event was (§2.1).

**Scope decision:** this design corrects the README text and wires exactly one
of them — `curve`, on the new `duckBumped` event, scaled by `speed`, because it
completes the interaction the whole section is about. `ssa-explosion`,
`ptx-stars`, `dome` and `trail-noise-short` are **out of scope** and stay open
items with corrected descriptions. Wiring four more flipbooks into the pop path
is a juice pass, not an end-card pass, and folding it in here would blur what
this change is.

---

## 7. Testing

New tests, all headless in `tests/sim/`:

1. **Ordering** — launch a duck into a same-colour duck; assert `duckBumped` is
   emitted for the pair and appears **before** `duckMatched` for the same
   contact.
2. **Colour independence** — launch into a *different*-colour duck; assert
   `duckBumped` fires and `duckMatched` does not. This is the case that is
   entirely unreported today.
3. **Substep spam guard** — settle a cluster of ducks in mutual contact, step
   120 ticks, assert `duckBumped` count is **0**. This asserts the §2.3
   self-debouncing claim rather than trusting it, and is the test that would
   have caught the 960-events/second failure mode.
4. **Speed fidelity** — assert the emitted `speed` equals the pre-impulse
   relative approach speed, not the post-bounce value.
5. **Determinism** — same seed, same sequence of `duckBumped` events across two
   runs.

Existing gates that must stay green: the full 211-test suite, the per-level
solvability gate, and `npm run tune` reproducing the same percentiles (proving
the event changed no physics).

View-side work is verified with `npm run build && npm run shot` — the screenshot
harness fails on console errors, and the end card must appear in a capture of
the cleared final level.

---

## 8. Level 8 — a measurement, not a prose edit

`src/sim/levels.ts:340-367` ("The Vault") claims the only route in is a 52px
needle on the far left, *"between the tub wall and (240,860) a duck's centre can
pass through x 92..144"*. The wall bumpers sit at **y=950** (`main.ts:203-210`),
directly below that lane, which is the collision the README flags.

This is resolved by **measuring, not by editing prose to match a guess**: a
headless test that fires ducks down the lane across a fan of angles and reports
whether any reach the clam at (360,1010). Then either the comment is corrected to
describe what the geometry actually permits, or the bumper is nudged and the
level re-tuned. Which of the two is decided by the measurement.

Because the comment also carries a **safety note** — the left lane prevents a
board state where no shot is legal — the softlock test must stay green whichever
way this goes. Nudging bumper geometry is the higher-risk option and requires a
re-run of `npm run tune` for level 8.

---

## 9. Out of scope

- New levels, and the level-schema gaps (per-level respawn colours, multiple
  spawn regions, multi-hit clams).
- Wiring `ssa-explosion`, `ptx-stars`, `dome`, `trail-noise-short` (§6).
- The repo migration (D1) — blocked on the new repo URL.
- The four non-code submission deliverables (concept intro, second-concept brief,
  iteration idea, hosted link + source), tracked separately.

---

## 10. Build order

1. `duckBumped` — event, measured threshold, tests. *(sim; everything else is
   additive to it)*
2. Audio module + clip mapping, including `duckBumped`.
3. Persistent CTA chip + mute toggle.
4. End card.
5. Fail title plate.
6. `curve` on `duckBumped`; README VFX correction.
7. Level 8 measurement and resolution.

Each step is a commit, pushed to `levels-clam-moves`.
