export type Colour = 'yellow' | 'green' | 'purple' | 'red';

export interface Duck {
  id: number;
  kind: 'duck';
  colour: Colour;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** true from launch until it comes to rest — pops/damage need a live duck */
  live: boolean;
  /**
   * This duck is a player's shot that has not yet reached a duck.
   *
   * Set by launch(), spent by the first duck-duck contact it makes, and dropped
   * if the shot comes to rest without reaching one — the strike belongs to the
   * shot in flight, never to the duck afterwards. It is what tells
   * collideDuckPairs which single contact per shot gets SHOT_STRIKE_SPEED
   * instead of the ordinary impulse.
   */
  shotStrikePending: boolean;
  /** fixed steps spent moving — drives the flight-drag ramp; reset on launch/stop */
  ticksMoving: number;
  /** set the instant the duck leaves the world, so it can't be popped twice */
  popping: boolean;
  /** fuse lit: same-colour contact or a blast caught it. Keeps full physics. */
  matched: boolean;
  /** fixed-step ticks left on the fuse; at 0 the duck pops (see SIM.MATCH_FUSE_TICKS) */
  matchFuse: number;
  /** caught by a blast: pops after settling + a stillness hold (fuse is the failsafe) */
  popOnSettle: boolean;
  /** fixed steps of spawn protection left — while >0, explosions in progress
   *  cannot doom, shove or recruit this duck (see SIM.SPAWN_SHIELD_TICKS) */
  spawnShieldTicks: number;
  /** consecutive fully-static ticks while doomed — resets the moment it moves */
  settleTicks: number;
}

export interface Barrel {
  id: number;
  kind: 'barrel';
  /** every barrel is the standard wooden crate; damage stage lives in hp */
  skin: 'wood';
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  golden: boolean;
  /** fixed-step ticks left debouncing ONE duck's collision — see hitBy */
  hitCooldown: number;
  /**
   * Which duck `hitCooldown` is debouncing. The window exists only to stop a
   * single physical collision counting twice across the 2-16 adaptive substeps
   * — never to swallow a second duck's separate hit, so a different id always
   * lands. 0 = nobody.
   */
  hitBy: number;
}

/**
 * The clam (the pack's oyster rig). A REPEATABLE pearl dispenser, not a one-shot
 * goal: a duck reaching the shell opens it, which spills a pearl, then shuts and
 * re-arms. It is solid at all times — open, shut or spent it bounces ducks,
 * because the rig is the game's bumper ("GameEntityBumper renders as this
 * oyster", asset manifest).
 *
 * THE SHELL IS NEVER BUSY: `open` is the shell's POSE, not a latch. A hit
 * landing mid-cycle restarts the cycle and spills another pearl — see hitClam.
 *
 * Once the level's pearl goal is met every clam goes `active: false`: still
 * solid, still visible, but inert — no open beat and no further pearls.
 */
export interface Clam {
  id: number;
  kind: 'clam';
  x: number;
  y: number;
  skin: 'normal' | 'gold' | 'baby';
  /** the shell is up and the mouth showing; re-hitting an open shell re-opens it */
  open: boolean;
  /** fixed steps since the shell last opened; at CLAM_CYCLE_TICKS it shuts */
  cycleTicks: number;
  /** false once the pearl goal is met: a plain solid bumper from then on */
  active: boolean;
  /**
   * Ducks whose collision has already been counted THIS fixed step — the whole
   * debounce, and deliberately no more than that. Adaptive substepping runs the
   * clam collision 2-16 times per step, so ONE physical collision can register
   * as an approach twice inside a step; it must never swallow the next step's
   * contact, which is a hit the player watched land. Cleared in tickClams.
   */
  hitThisStep: number[];
}

/**
 * A pearl in the air between the shell that spilled it and the HUD counter.
 *
 * It carries its OWN flight clock rather than riding the shell's cycle, because
 * a shell can spill again while the last pearl is still climbing — every hit
 * pays out, so two pearls from one clam overlap routinely. Timed off the shell,
 * the first pearl's arrival would be lost when the second restarted the cycle:
 * it would hang in the air and the counter would never move for it.
 */
export interface Pearl {
  id: number;
  /** the shell it came out of — the view needs it for nothing but bookkeeping */
  clam: number;
  /** fixed steps flown; at SIM.PEARL_FLIGHT_TICKS it reaches the counter */
  ticks: number;
}

export type SimEvent =
  | { type: 'duckLaunched'; id: number }
  | { type: 'duckStopped'; id: number }
  /** (x,y) is the contact point, (nx,ny) the outward normal, speed pre-kick */
  | { type: 'wallHit'; id: number; x: number; y: number; nx: number; ny: number;
      speed: number; source: 'wall' | 'bumper' }
  /**
   * Duck-duck contact — the game's most common interaction, and until now the
   * only collision routine in world.ts that reported nothing (walls emit
   * `wallHit`, clams `bumperHit`, barrels `barrelDamaged`). `a`/`b` are the ids
   * in collision order, (x,y) the contact midpoint, `speed` the PRE-impulse
   * relative approach speed so the view can scale volume and fx by impact force.
   */
  | { type: 'duckBumped'; a: number; b: number; x: number; y: number; speed: number }
  | { type: 'duckMatched'; id: number }
  | { type: 'duckPopped'; id: number; colour: Colour; x: number; y: number }
  | { type: 'blast'; colour: Colour; x: number; y: number; r: number }
  | { type: 'duckSpawned'; duck: Duck }
  /**
   * A duck touched this crate — the flinch, reported for its own sake.
   *
   * Separate from `barrelDamaged` on purpose: being touched and losing a stage
   * are different questions, and the crate's little bounce answers the first
   * one. It used to be hung off `barrelDamaged`, so a glancing touch or a
   * second duck arriving inside the damage cooldown bounced off a crate that
   * never moved. (x,y) is the duck's centre at contact and `speed` the
   * PRE-bounce approach speed, so the view can scale the sound by impact.
   */
  | { type: 'barrelBumped'; id: number; x: number; y: number; speed: number }
  | { type: 'barrelDamaged'; id: number; hp: number }
  | { type: 'barrelDestroyed'; id: number; x: number; y: number }
  | { type: 'barrelSpawned'; barrel: Barrel }
  | { type: 'clamSpawned'; clam: Clam }
  /** the clam took the hit and is cracking open (view plays the open sequence) */
  | { type: 'clamOpened'; id: number; x: number; y: number }
  /** the pearl that hit spills. `id` is the shell, `pearl` this pearl's own id —
   *  two from one shell can be in the air at once, so the view keys off `pearl` */
  | { type: 'pearlReleased'; id: number; pearl: number; x: number; y: number }
  /** the pearl reached the HUD counter — this, and only this, decrements it.
   *  The World does not know the level's goal; the Director counts and reports. */
  | { type: 'pearlCollected'; id: number; pearl: number }
  /** the shell has shut again and is ready to be activated a second time */
  | { type: 'clamClosed'; id: number }
  /** the pearl goal is met: every clam is now an inert (but visible) bumper */
  | { type: 'clamsSpent' }
  /** pearls REMAINING out of the level's goal — the HUD reads "left/total" */
  | { type: 'pearlCounter'; left: number; total: number }
  | { type: 'bumperHit'; id: number; x: number; y: number }
  | { type: 'levelStarted'; index: number; name: string; moves: number }
  | { type: 'movesLeft'; left: number }
  /** whole seconds left on the board's countdown; emitted only when it CHANGES,
   *  so draining the queue does not cost 60 events a second for a number that
   *  moves 30 times */
  | { type: 'timeLeft'; seconds: number }
  | { type: 'counter'; done: number; total: number }
  | { type: 'finaleArmed' }
  /** `reason` is which limit actually bit. Both are checked at the same settle
   *  point, and time wins the tie — a board that runs out of both was out of
   *  time first, since the clock cannot be spent early the way moves can. */
  | { type: 'levelFailed'; index: number; reason: 'time' | 'moves' }
  | { type: 'levelCleared'; index: number; movesLeft: number }
  | { type: 'won' };
