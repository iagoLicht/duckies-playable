# The timer-lose rigged build — `duckies_timer_lose_rigged`

**Date:** 2026-08-08 · **Status:** approved by the goal brief (autonomous session;
the brief fully specified requirements, so the usual design dialogue was resolved
against it and the calibration data below)

## What the build is

One self-contained HTML file, `dist/duckies_timer_lose_rigged.html`, carrying the
ad's existing two-beat story with the second beat tuned so that it **consistently
ends in a believable near-win loss**:

- **Beat 1 — level 9 "The Gauntlet":** plays exactly as shipped, the viewer
  clears it, the existing win card (`NEXT LEVEL`) walks them into beat 2.
- **Beat 2 — level 10 "The Golden Pearl":** the clock takes it, with the pearl
  counter a hair short of done — the player feels they lost the round, not the
  game's respect. If they do win, the existing terminal win card
  (`CONGRATULATIONS!` → `PLAY NOW` → store) is the fallback; both endings land
  on the store.

Nothing in this build invents new flow: `flow.ts` already scripts beat 1 → win
card → beat 2 → terminal card either way. What changes is *how reliably beat 2
produces the near-miss*, and the export's file name.

## Why static tuning is not enough — measured

`tests/tools/calibrate-clock.mjs` (new, esbuild-bundles the shared bot the same
way tune-levels.mjs does) plays the real board under the real 30s clock and the
real 11-move budget, at two skill settings, 250 seeds each. Sweeping the pearl
quota alone:

| quota | thumb win% | losses ≤3 short | losses ≤5 short |
| ----- | ---------- | --------------- | --------------- |
| 40 (shipped) | 20% | 23% | 33% |
| 30 | 61% | 68% | 84% |
| 26 | 73% | 88% | 90% |

The two requirements pull the one dial in opposite directions: quotas that make
losses *close* make losses *rare*, because per-seed pearl pace varies by ±6-8
pearls over 30 seconds. **No static quota yields "generally lose" and "almost
won" at once.** Something has to compress the variance.

## Design: a supply-side pace governor

The sim gains one small, per-level-gated policy: **steer what the board offers,
never what the player earned.**

Every pearl remains a real pearl from a real hit — `hitClam`'s
every-hit-pays rule (the fix for the 48%-of-contacts-dead bug) is untouched, as
are physics, aim assist, clam timing, move budget and the clock. The governor
only leans on the two decisions that were already random:

1. **Respawn colour.** `fillField` picks uniformly today. Governed, it
   sometimes (probability `colourGain · |pressure|`) picks the colour with the
   most — when behind pace — or fewest — when ahead — resting same-colour
   mates, so matches (and the blasts that crack clams) come easier or slower.
2. **Respawn placement.** `freeSpot` samples the spawn region uniformly.
   Governed, the sampled window shrinks toward the clam end of the region when
   behind, away from it when ahead, by at most `placeGain` of its height.

`pressure` is the pace error, normalised and clamped to ±1:

```
ideal(t)  = (quota − targetLeft) · min(1, elapsed/clock)
pressure  = clamp((collected − ideal) / spread, −1, +1)
```

A run tracking toward "finish with `targetLeft` left at 0:00" feels no steering
at all; the further a run drifts from that line, the harder its *future supply*
leans back toward it. A hot streak still wins — the governor biases odds among
legal, plausible choices; it cannot confiscate pearls, block hits, or stop a
last-second chain (which the sim already lets finish past 0:00 — the built-in
cliffhanger).

### Schema

`LevelDef` gains an optional block; only level 10 sets it:

```ts
pace?: {
  targetLeft: number;   // pearls the ideal run is still short at 0:00
  spread: number;       // pearls of pace error that saturate the steering
  colourGain: number;   // 0..1: odds a respawn colour is steered at |pressure|=1
  placeGain: number;    // 0..1: max shrink of the spawn window
}
```

### Guards

- **Absent `pace` ⇒ bit-identical behaviour**, including the RNG call sequence,
  so every other level, every replay and the tuner see no change at all.
- **Infinite clock ⇒ governor off** (`pressure = 0`): the playthrough
  solvability gate and the budget tuner run untimed and must keep measuring the
  un-steered board.
- Deterministic: the governor is a pure function of sim state, drawing only
  from the world's seeded RNG.

### Honesty line (what this design refuses to do)

No payout gating (a hit that visibly does nothing is the exact bug the clam
rework fixed), no fake counter motion, no physics or assist changes, no
invisible timer manipulation. If calibration had shown supply steering alone
cannot reach the targets, the documented fallback was the official game's own
inert-shell state (visibly napping clams) — **not needed; see numbers below.**

## Calibration results and the locked operating point

Measurement revised the design twice before the numbers settled:

1. **Supply steering alone compressed too little.** Colour, placement, assist
   and respawn-hold steering moved the mean but left a fat lucky-win tail:
   ~35-50% wins at every near-miss quota.
2. **The tail was the clam ping-pong.** A duck bouncing between shells 260px
   apart milks a pearl per touch and never pops — so it never books a respawn,
   and a respawn is the only moment the governor gets a decision. Widening the
   clams to 350px apart (185/535) damps exactly that pattern: bot wins fell
   from ~50% to ~17% in the same quota band, and the freed crate lanes mean
   ~90% of losses now end with every crate down. The governor then holds the
   rest of the distribution together.
3. On the paced board the **finale flourish no longer cranks assist to 0.9**
   (it stays the view's drama event): a near-max assist endgame is a
   help-them-win device, and this board's brief is the opposite. The governed
   assist keeps breathing instead — up for lagging runs, down for hot ones.

Locked (400 clocked seeds, both skill profiles — table in the level comment):
**quota 31, clams 185/535,
`pace { targetLeft 3, spread 2, colourGain 1.0, placeGain 0.85, assistGain 0.25, holdGain 2.2 }`**
→ thumb wins 17.3%, focused 12.5%; **100% of losses are the clock's** (zero
move-outs); losses die at p25/p50/p75 = 3/5/8 pearls short, 87-89% within 9.
The bot cannot feel the assist breathing (its aim-hunt locks ducks regardless),
so real lagging players land tighter than these bot margins. Win rates near
15% read as "generally lose, genuinely winnable", which is the brief's
"exceptional case" with the fallback card reachable for real.

`tests/sim/rigged.test.ts` replays a seed batch and asserts the distribution
so a future tuning pass cannot silently break the ad's ending.

## Export

`scripts/pack.mjs` learns an output name (env `DP_OUT_NAME`, default unchanged
`duckies-pop-playable`), and the rigged artifact is produced as
`dist/duckies_timer_lose_rigged.html` by the same typecheck → vite build →
inline+gzip → 5MB-gate pipeline. No content flag: the repo's two-beat ad *is*
this ad; the name labels the campaign variant for the network dashboard.

## Validation before the build is called done

1. `npm test` green (includes the new distribution gate and the untouched
   solvability gates).
2. Sim-level: calibration table meets the targets above.
3. Browser, dev build: scripted full-flow runs — L9 win → card → L10 —
   confirming near-miss reads on screen (counter at 1-4, crates cleared, red
   clock) and the terminal card copy; plus the `?card=win` presentation of the
   beat-2 win fallback.
4. Built file: `tests/shot.mjs` (console-error gate), full-flow visual pass,
   and the perf harness's idle+played runs at 4×/8× CPU throttle against the
   **built** artifact — production claims are made on the shipped file only.
