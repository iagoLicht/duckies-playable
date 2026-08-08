/** All tunables. Units: design px (720x1280 stage), seconds, px/s. */
export const SIM = {
  DT: 1 / 60,
  /** adaptive substepping (official): enough substeps to keep per-substep travel near this */
  SUBSTEP_DIST: 10,     // ≈ their 0.3·CANDY_RADIUS at 90 px/unit

  DUCK_R: 46,
  BARREL_R: 60,
  /** the oyster rig is 126x155; this is its solid bumper radius at scene scale */
  CLAM_R: 56,

  // ── the clam's open→collect→shut cycle. A clam is a REPEATABLE pearl
  // dispenser, not a one-shot goal: it opens, spills one pearl, the pearl flies
  // to the HUD and decrements the counter, then the shell shuts and re-arms.
  // Every number here is a tick count so the sim owns the whole sequence and the
  // view can animate straight off it — nothing is timed twice in two places.
  //
  // THE IMPACT IS ONE FRAME. The fling, the shell's squash, the opening and the
  // pearl all begin on the contact tick — there is deliberately no spill delay.
  // (There used to be: the view played `bump-inactive` as a 0.267s "it jolts but
  // stays shut" react before `bump`, and the pearl waited out both. That read as
  // four separate beats instead of one hit. `bump` carries its own squash on the
  // oyster/mouth/eye bones, so dropping the pre-beat keeps the movement and only
  // removes the stall.) Trade-off, deliberate: `bump` re-attaches the lid for
  // most of its 0.30s run and strips it at the very end, so for ~0.2s the pearl
  // is rising over a shell that still looks shut.
  /** each pearl's own flight from the shell to the HUD counter, timed from the
   *  IMPACT that spilled it — two pearls from one shell can overlap in the air */
  PEARL_FLIGHT_TICKS: 42,        // 0.70s
  /** impact → shell shut again. Must outlast `bump` (0.30s) plus a readable beat
   *  of `idle`. It is NOT a lockout: a hit landing mid-cycle restarts the count
   *  and pays out again, so this only decides how long the shell stays up. */
  CLAM_CYCLE_TICKS: 60,          // 1.00s
  // There is deliberately NO hit cooldown on a clam (user-locked 2026-08-07),
  // for the reason there is no minimum approach speed on a barrel: a window in
  // ticks cannot tell a substep duplicate from a real second hit, and CLAM_HIT_
  // COOLDOWN_TICKS 12 was the smaller half of a pair of gates that between them
  // silenced 48% of every contact. The debounce that replaced it is per duck and
  // scoped to the substep loop itself — Clam.hitThisStep, cleared every step.

  // The oyster IS the game's bumper ("GameEntityBumper renders as this oyster…
  // Adds pinball deflection juice", asset manifest), so it flings like the wall
  // bumpers rather than reflecting at half energy the way a barrel does. Same
  // formula as WALL/BUMPER above — a fixed outgoing normal speed plus a share of
  // the incoming — but deliberately punchier than the pink wall tips: a
  // full-speed slam comes back at nearly the speed it arrived, and even a slow
  // roll is thrown clear. This is a FEEL knob; turn these two, not the geometry.
  CLAM_KICK: 600,                // fixed part of the outgoing normal speed…
  CLAM_KEEP: 0.7,                // …plus this share of the incoming speed

  // ── movement, from the official example verbatim (decomp xr, at 90 px/unit).
  // Drag is v *= 1/(1 + DRAG·dt) per fixed step, banded: a fresh shot flies
  // nearly free (ramping quartically over DRAG_RAMP_TICKS), but the moment it
  // touches anything the whole table switches to the heavy contact drag.
  DRAG_FLIGHT: 0.45,    // qs — while the shot is still clean
  DRAG_SETTLE: 1.35,    // Ws — ramp target, and any duck below SLOW_SPEED
  DRAG_CONTACT: 1.6,    // Ks — everyone, once the shot has hit something
  DRAG_RAMP_TICKS: 120, // Xs
  STOP_SPEED: 38.2,     // √0.18 u/s — below this a duck halts dead
  SLOW_SPEED: 52.5,     // √0.34 u/s — below this drag is DRAG_SETTLE
  MAX_SPEED: 4140,      // Ar 46 u/s — cap applied after a wall/bumper kick

  // ── wall bounce (decomp Yr): NOT a mirror. The tangential velocity survives
  // untouched and the exit speed along the normal becomes a share of TOTAL
  // speed, floored — so a grazing duck is thrown out and a wall never absorbs.
  WALL_KICK: 0.93,      // ir
  WALL_MIN_KICK: 135,   // 1.5 u/s
  // user-tuned DOWN from the official peg fling (tr 2700 + er 0.5·v): the red
  // bumpers should be a mild redirect, not a launcher — a head-on full-speed
  // shot leaves at ~58% of its incoming speed, a slow roll still gets a
  // visible (but modest) push, and grazing hits keep their tangential glide
  BUMPER_KICK: 350,     // fixed part of the outgoing normal speed…
  BUMPER_KEEP: 0.45,    // …plus this share of the incoming speed
  RESTITUTION_BODY: 0.96,   // sr — duck-duck impulse
  RESTITUTION_STATIC: 0.5,  // barrels: plain normal reflection at half energy
  /**
   * THE PLAYER'S SHOT LANDS AT FULL STRENGTH, WHATEVER THE ANGLE (user-locked
   * 2026-08-07). The first duck each launched duck reaches leaves at exactly
   * this speed, along the contact normal — the angle picks the DIRECTION and
   * nothing else. See collideDuckPairs.
   *
   * MEASURED, not chosen. The plain equal-mass impulse scales with the normal
   * component of the approach, so a shallow contact transfers almost nothing.
   * Over the campaign bot (1045 player shots), the target's departure speed by
   * impact obliquity — 1 is dead centre, 0 a pure graze:
   *
   *   graze   <0.35   n=42    p50   630
   *   oblique .35-.7  n=83    p50  1416
   *   solid   .7-.9   n=134   p50  2075
   *   centre   >0.9   n=786   p50  2549
   *
   * A graze left with a quarter of a centre hit, and three quarters of all
   * shots are already near-centre. So the constant is the centre-hit median:
   * the shots that already felt right are unchanged, and the rest come up to
   * meet them. Reproduce with the probe described in tests/sim/strike.test.ts.
   */
  SHOT_STRIKE_SPEED: 2550,

  GRAB_R: 80,           // pointer-to-duck pickup radius
  MIN_PULL: 40,         // below this, release is a whiff (no shot)
  // official threshold: pulls under this neither aim nor fire
  LAUNCH_SPEED: 2700,   // Os 30 u/s × shotForceScale 1 — drag sets direction only

  // Match constants below are the official example's, converted at our 90 px/unit.
  // (decomp `or`: POP_SPEED 1.4 u/s, BLAST_RADIUS 1.5 u, MATCH_FUSE_TICKS 90,
  // MATCH_BLINK_TICKS 9.) Same-colour contact at speed does NOT pop on impact —
  // it lights a fuse: the duck keeps full physics, blinks white, and pops when
  // the fuse runs out. Each blast relights a fresh fuse on the ducks it catches,
  // so a chain costs one full fuse per generation.
  //
  // THE FUSE IS THE AD'S, NOT THE OFFICIAL'S (user-locked 2026-08-08). This is a
  // playable ad, and the official 90-tick fuse buys nothing an ad can spend: it
  // is dead time in which the player watches and cannot act, and it is paid once
  // PER CHAIN GENERATION, so the deepest chain the sim can produce charged 7.5s
  // of it. Cut to 36 with the blink band cut alongside — see MATCH_BLINK_TICKS,
  // the two must move together or the flash stops reading. Nothing about the
  // mechanic changed: same trigger, same blast, same order of beats.
  POP_SPEED: 126,       // min relative speed for a same-colour pair to match
  /**
   * Floor on the closing speed a duck-duck contact needs to report `duckBumped`.
   *
   * MEASURED, and the measurement's headline is a NEGATIVE result. The design
   * expected a bimodal histogram — settling jitter down near zero, real hits far
   * above — and a threshold placed in the trough. Instrumenting the bot over all
   * 10 levels x 15 seeds with the gate wide open gives 4149 contacts whose |rel|
   * is smooth and single-peaked (log2 mode at 1024..2048 px/s), with only
   * 13 events (0.31%) under 20 px/s and 3 under 1 px/s. There is no jitter
   * population, i.e. the impulse in collideDuckPairs really is self-debouncing
   * and no per-pair cooldown is needed. So there is no trough to sit in, and the
   * threshold is instead anchored to an existing constant: a contact closing
   * slower than the speed at which the sim halts a duck outright cannot read as
   * a bounce. Rejects 31/4149 = 0.75% of contacts (just under the measured p1 of
   * 43.6). Reproduce with shots/bump-histogram.mjs.
   */
  BUMP_MIN_SPEED: 38.2, // == STOP_SPEED
  // There is deliberately NO minimum approach speed for damaging a barrel
  // (user-locked 2026-08-07). BARREL_HIT_SPEED 90 used to gate it and, because
  // it tested the NORMAL component, it swallowed grazing hits at any speed as
  // well as soft ones — see collideDuckBarrels. STOP_SPEED is the real floor:
  // the step snaps anything slower to exactly zero, so a resting duck cannot
  // nibble a crate.
  BARREL_HIT_COOLDOWN_TICKS: 12, // one duck's collision counts once (0.2s)
  BLAST_R: 135,
  MATCH_FUSE_TICKS: 36, // fixed steps from match to pop, 0.60s (60 ticks = 1 s)
  /**
   * Fixed steps per white/normal blink band.
   *
   * TIED TO THE FUSE, NOT INDEPENDENT. What the player reads is not the band
   * length, it is the COUNT of flashes — "that one is lit" needs enough
   * alternations to register as a flash rather than a single tint. The official
   * 9 against a 90 fuse gave 5; keeping 9 against the ad's 36 would leave 2,
   * which reads as the duck briefly turning white and then exploding for no
   * stated reason. 5 restores ~3.6 flashes in the shorter window, and the faster
   * flicker is itself the urgency an ad wants. If MATCH_FUSE_TICKS ever moves
   * again, move this with it and keep the quotient near 7.
   */
  MATCH_BLINK_TICKS: 5,

  // Blast shove (user-requested feel change over the official, which has no
  // impulse and pops on the fuse alone): every duck inside the radius, whatever
  // its colour, takes a SUBTLE radial kick and is DOOMED — it blinks from the
  // moment the blast catches it, drifts a little, and explodes ONLY once it is
  // fully idle: at rest AND static for the confirmation period below. Nothing
  // else pops it — a victim never goes off mid-slide — so every generation keeps
  // the same order of beats: pop → nudge → blink → settle → hold → pop.
  BLAST_KNOCK: 150,      // px/s added at the blast centre…
  BLAST_KNOCK_EDGE: 70,  // …falling off linearly to this at the rim
  /**
   * Consecutive fully-static ticks before the pop — the "it stopped… BANG" beat.
   *
   * Tuned by hand at the original pace: 45 (0.75s) read as a hang, 0 popped
   * before the stop registered, 24 (0.40s) was the beat that landed. Cut to 10
   * (0.17s) for the ad (user-locked 2026-08-08). This one has a hard floor and
   * it is not comfort: it must stay above zero or the pop fires on the same
   * frame the duck halts, and the eye never gets the stop it is the punctuation
   * for. 10 ticks is still six frames of held stillness — enough to register the
   * beat, not enough to feel like a wait.
   *
   * Must also stay below MATCH_FUSE_TICKS (asserted in blast.test.ts): a contact
   * match pops on the LATER of its fuse and this hold, so a hold that outran the
   * fuse would silently become the only thing timing a match.
   */
  BLAST_SETTLE_CONFIRM_TICKS: 10,

  /**
   * A duck pops → its replacement is due this many seconds later.
   *
   * Measured from the POP that owes it (user-locked 2026-08-08, see
   * handleRespawns), so it is a per-duck debt and not a per-turn pause. It used
   * to be measured from the board SETTLING, which meant a chain that took two
   * seconds to unwind left the board short for all of it and only then started
   * counting; the field is now back to full while the chain is still going off.
   * Cut 0.6 → 0.2 for the ad earlier the same day.
   *
   * It is not zero on purpose — arriving on the very frame of the bang reads as
   * the explosion having spawned the replacement.
   */
  RESPAWN_DELAY: 0.2,
  /**
   * The board's countdown, in fixed steps — 30 s at 60 Hz. This lived in the
   * view as a decorative number until now; the README's own rule ("A limit
   * enforced only in the view is not enforced", learned on the move budget)
   * is why it is here instead. Hitstop freezes the sim, so it freezes the
   * clock too — the player is not charged for the game's own freeze frames.
   */
  LEVEL_TICKS: 30 * 60,
  ASSIST_CONE_DEG: 28,
} as const;
