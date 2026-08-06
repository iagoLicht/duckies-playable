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
  /** fixed-step ticks before contact damage can land again — one hit per collision */
  hitCooldown: number;
}

/**
 * The clam (the pack's oyster rig). A REPEATABLE pearl dispenser, not a one-shot
 * goal: a duck striking it hard enough, or a blast reaching it, opens the shell,
 * which spills exactly one pearl, then shuts and re-arms. It is solid at all
 * times — open, shut or spent it bounces ducks, because the rig is the game's
 * bumper ("GameEntityBumper renders as this oyster", asset manifest).
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
  /** true for the whole open cycle — an open clam cannot be re-triggered */
  open: boolean;
  /** fixed steps elapsed in the current cycle; drives spill, collect and shut */
  cycleTicks: number;
  /** false once the pearl goal is met: a plain solid bumper from then on */
  active: boolean;
  /** one physical collision opens the shell once, across substeps and jitter */
  hitCooldown: number;
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
  | { type: 'barrelDamaged'; id: number; hp: number }
  | { type: 'barrelDestroyed'; id: number; x: number; y: number }
  | { type: 'barrelSpawned'; barrel: Barrel }
  | { type: 'clamSpawned'; clam: Clam }
  /** the clam took the hit and is cracking open (view plays the open sequence) */
  | { type: 'clamOpened'; id: number; x: number; y: number }
  /** the single pearl it spills, once the lid is genuinely off (CLAM_SPILL_TICKS) */
  | { type: 'pearlReleased'; id: number; x: number; y: number }
  /** the pearl reached the HUD counter — this, and only this, decrements it.
   *  The World does not know the level's goal; the Director counts and reports. */
  | { type: 'pearlCollected'; id: number }
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
