import type { Container } from 'pixi.js';
import type { SkeletonData, Spine } from '@esotericsoftware/spine-pixi-v8';
import { makeSpine } from '../engine/spineLoader';
import { chooseDemoShot, type DemoShot } from '../sim/demoShot';
import type { Director } from '../sim/director';

/**
 * THE AD PLAYS ONE SHOT FOR A VIEWER WHO IS NOT PLAYING.
 *
 * This is a timed playable: a viewer who does not work the mechanic out watches
 * thirty seconds run down without firing once, and the run ends having taught
 * nothing. So the moment the board is genuinely waiting, the game puts a hand on
 * the best shot going — grab, pull back, hold the aim long enough to read — and
 * then LETS GO WITHOUT FIRING, over and over, for as long as nobody plays.
 *
 * IT SHOWS, IT NEVER PLAYS (user-locked 2026-08-08). An earlier pass had the
 * hand take the run's first shot for the viewer; that is gone. The hand demon-
 * strates the gesture and the shot stays the player's, every time — paired with
 * the one-line instruction across the top of the board (GameScene's hint text),
 * which says in words what the hand is doing in mime.
 *
 * `cancel()` at the end of the gesture, never `end()`: the whole difference
 * between a hint and a move is that one of them fires. Director.demoLaunch — the
 * free-shot flag this used to arm — is consequently never set from here.
 *
 * It DRIVES THE REAL SLINGSHOT with synthetic pointer positions rather than
 * animating a mime of one. The selection ring, the aim line, the red X, the
 * duck's `turn` facing, the launch sound and the physics are therefore the ones
 * the player would have got, because they are literally the same code — there is
 * no second, drifting copy of what a shot looks like. The only thing that is not
 * a real shot is the bill: see Director.demoLaunch.
 *
 * It teaches, it does not play. It runs only on the ad's own beats, it costs no
 * moves, and any touch stops it mid-gesture and hands the board straight back.
 */

/**
 * How long the board sits untouched AFTER A TURN before the hand comes back
 * (user-locked 2026-08-08). A hand reaching in the instant everything stops
 * reads as the game playing over the player; a moment to decide first is what
 * makes it read as a hint. Any pointer event restarts it, so a player who is
 * still thinking with their finger on the glass keeps the hand away.
 *
 * The board's FIRST gesture is exempt — a level opening on a still board is the
 * dead time this whole feature exists to kill, and nobody needs a moment to
 * decide before they have seen the board.
 */
const SETTLE_GRACE = 1.5;
/**
 * …and this long once the player has actually played. Somebody who has taken a
 * shot has read the hint; replaying it 1.5s into every pause would be nagging,
 * so the hand keeps its distance and only comes back if they genuinely stall.
 */
const REPLAY_DELAY = 3;
/** hand slides from the duck to the pull point over this long */
const DRAG_TIME = 0.45;
/** …then HOLDS the aim, stock still, for this long. The part that teaches. */
const HOLD_TIME = 0.9;
/** let go, then the hand fades out over this long */
const FADE_TIME = 0.25;
/** the gesture lets go here — WITHOUT firing. See the note at the top. */
const LET_GO_AT = DRAG_TIME + HOLD_TIME;
/**
 * A refused probe waits this long before the board is asked again. chooseDemoShot
 * scores every (shooter, target) pair and dry-runs each candidate through the
 * real slingshot; with the gesture now starting the instant the board is ready,
 * a board with nothing to show would otherwise pay for that walk every frame.
 * Nothing is lost by waiting — the answer cannot change while the board stays
 * settled and untouched.
 */
const PROBE_RETRY = 4;

const HAND_SCALE = 0.25;
/**
 * The rig's own canned aim art, detached on this instance. `band`, a ghost duck
 * and nine trail dots are attached in the setup pose, authored for the
 * `tutorial-aim*` animations — but this hand is a CURSOR for the game's real aim
 * line, and two trails pointing two ways is worse than no hint at all. What is
 * left is the hand, its finger and its shadow.
 */
const CANNED_SLOTS = [
  'band', 'duck-ghost', 'split-a',
  'dot', 'dot2', 'dot3', 'dot4', 'dot5', 'dot6', 'dot7', 'dot8', 'dot9',
];
/**
 * The rig's origin is not its fingertip, and the fingertip is what a touch
 * actually contacts. MEASURED, not guessed: parked at a known design point and
 * screenshot (shots/probe-hand-origin.mjs), the tip sits at origin + (9, -15),
 * so the origin goes here to put the tip on the pointer.
 */
const HAND_OFFSET = { x: -9, y: 15 };

const quadOut = (t: number): number => 1 - (1 - t) * (1 - t);

/**
 * What the demo needs from the scene. Four members on purpose: the driver stays
 * a thing you can read in one sitting, and scene.ts does not grow another
 * subsystem inside itself.
 */
export interface IdleDemoHost {
  readonly director: Director;
  /**
   * Is the board settled, whole, stocked, drawn and waiting on the player?
   * GameScene.boardReady() — nothing moving, no fuse burning, no pearl in the
   * air, every owed duck respawned AND its view finished growing in.
   */
  ready(): boolean;
  /** the view side of a grab: the launch-pull sound the player's grab makes */
  grab(duckId: number): void;
  /** the view side of a release: the rig's snap-back if it fired, aim UI cleared */
  release(duckId: number, fired: boolean): void;
}

export class IdleDemo {
  /** seconds the ready board has gone untouched — every pointer event resets it */
  private idleFor = 0;
  /** seconds into the running gesture, or null when no gesture is running */
  private t: number | null = null;
  private shot: DemoShot | null = null;
  /** seconds before a start may be attempted again after a refused probe */
  private retryIn = 0;
  /**
   * Has the player taken the board over at any point in the run? Deliberately
   * NOT cleared by `reset`: one instance serves the whole run, so beat 2 does
   * not go back to nagging a viewer who has been playing since beat 1.
   */
  private played = false;
  /** has a gesture run on THIS board yet? The first one skips SETTLE_GRACE. */
  private firstOnBoard = true;
  /** seconds of hand fade-out left after a release */
  private fading = 0;
  private readonly hand: Spine;

  constructor(private host: IdleDemoHost, handData: SkeletonData, layer: Container) {
    this.hand = makeSpine(handData);
    this.hand.scale.set(HAND_SCALE);
    this.hand.visible = false;
    layer.addChild(this.hand);
  }

  /** true while a demo gesture is on screen */
  get running(): boolean {
    return this.t !== null;
  }

  /**
   * The player has taken the board over. Called from the first line of
   * pointerdown, before that handler does anything else, so the touch that
   * interrupts is also the touch that grabs — the player never loses one.
   *
   * A touch also marks the run as PLAYED, whether or not a gesture was running:
   * somebody reaching for the screen does not need to be shown again a second
   * and a half later. From here the hand waits out REPLAY_DELAY instead.
   */
  takeOver(): void {
    this.played = true;
    this.abort();
  }

  /**
   * Drop everything and give the board back, THIS FRAME — without spending the
   * lesson. This is the board's own reasons for stopping (a level swap, an end
   * card landing over a hand that is still reaching), not the player's; see
   * `takeOver` for that.
   */
  abort(): void {
    if (this.t !== null) {
      const id = this.shot?.duck.id ?? null;
      this.host.director.slingshot.cancel();
      if (id !== null) this.host.release(id, false);
    }
    this.t = null;
    this.shot = null;
    this.idleFor = 0;
    this.retryIn = 0;
    this.fading = 0;
    this.hand.visible = false;
  }

  /** the idle clock starts again from zero — every pointer event pokes it */
  poke(): void {
    this.idleFor = 0;
  }

  /** the level swapped under us: no gesture, no clock, no hand */
  reset(layer: Container): void {
    this.abort();
    // a fresh board, so its first gesture is a level opening rather than a turn
    // ending — it goes up at once, without SETTLE_GRACE. `taught` deliberately
    // survives: beat 2 must not re-teach a viewer who has been playing since 1.
    this.firstOnBoard = true;
    // loadLevel unparents everything in the fx layer, this rig included
    layer.addChild(this.hand);
    this.hand.visible = false;
  }

  update(dt: number): void {
    if (this.hand.visible) this.hand.update(dt); // autoUpdate is off: rigs tick centrally
    if (this.t !== null) {
      this.advance(dt);
      return;
    }
    this.fadeHand(dt);
    // THE HAND WAITS ON THE BOARD AND ON NOTHING ELSE (user-locked 2026-08-08).
    // A chain taking two seconds to unwind, a respawn dropping ducks back in, a
    // pearl still climbing to the counter — the gesture may not start on top of
    // any of that, but the instant the turn is genuinely the player's, the hint
    // is there. The board coming ready IS the cue; there is no second wait.
    if (!this.host.ready()) {
      this.idleFor = 0;
      // the board is changing under the probe, so its last refusal is stale
      this.retryIn = 0;
      return;
    }
    this.idleFor += dt;
    if (this.retryIn > 0) {
      this.retryIn = Math.max(0, this.retryIn - dt);
      return;
    }
    // The board's first gesture goes up the moment the level is playable — a
    // level opening on a still board is the dead time this exists to kill. Every
    // one after it is a REPLAY, and waits: a beat for a viewer who is still
    // reading, a longer one for a player who has already shown they can shoot.
    const wait = this.firstOnBoard ? 0 : (this.played ? REPLAY_DELAY : SETTLE_GRACE);
    if (this.idleFor < wait) return;
    this.start();
  }

  private start(): void {
    const d = this.host.director;
    const shot = chooseDemoShot(d.world, d.slingshot);
    // Nothing legal to show, or the sling refused the grab. Back off rather than
    // asking every frame — see PROBE_RETRY.
    if (!shot || !d.slingshot.begin(shot.duck.x, shot.duck.y)) {
      this.retryIn = PROBE_RETRY;
      return;
    }
    this.shot = shot;
    this.t = 0;
    this.idleFor = 0;
    this.firstOnBoard = false;
    this.fading = 0;
    this.hand.visible = true;
    this.hand.alpha = 0;
    this.pose('pressed');
    this.placeHand(shot.duck.x, shot.duck.y);
    this.host.grab(shot.duck.id);
  }

  private advance(dt: number): void {
    const shot = this.shot!;
    const sling = this.host.director.slingshot;
    this.t! += dt;
    const t = this.t!;

    // fade in over the first stretch of the drag, so the hand arrives rather
    // than appearing, then hold at full
    this.hand.alpha = Math.min(1, t / (DRAG_TIME * 0.4));

    if (t < LET_GO_AT) {
      // decelerate into the hold: the gesture SETTLES onto its aim instead of
      // stopping dead on it, which is what a thumb does
      const k = quadOut(Math.min(1, t / DRAG_TIME));
      const x = shot.duck.x + (shot.pullTo.x - shot.duck.x) * k;
      const y = shot.duck.y + (shot.pullTo.y - shot.duck.y) * k;
      sling.move(x, y);
      this.placeHand(x, y);
      return;
    }

    // LET GO WITHOUT FIRING. `cancel()`, never `end()` — the whole difference
    // between a hint and a move is that one of them takes the shot, and this one
    // is the player's to take. The duck simply relaxes back onto its spot.
    sling.cancel();
    this.host.release(shot.duck.id, false);
    this.pose('raised');
    this.t = null;
    this.shot = null;
    this.idleFor = 0;
    this.fading = FADE_TIME;
  }

  private fadeHand(dt: number): void {
    if (this.fading <= 0) return;
    this.fading = Math.max(0, this.fading - dt);
    this.hand.alpha = this.fading / FADE_TIME;
    if (this.fading === 0) this.hand.visible = false;
  }

  /**
   * `pressed` keys NOTHING — it is a 0-length animation over the setup pose — so
   * it cannot undo the bones `raised` moved on the last release. The setup pose
   * is laid down first and the canned slots stripped again on top, because
   * setToSetupPose re-attaches every one of them.
   */
  private pose(anim: 'pressed' | 'raised'): void {
    this.hand.skeleton.setToSetupPose();
    for (const name of CANNED_SLOTS) this.hand.skeleton.findSlot(name)?.setAttachment(null);
    this.hand.state.setAnimation(0, anim, false);
  }

  private placeHand(x: number, y: number): void {
    this.hand.position.set(x + HAND_OFFSET.x, y + HAND_OFFSET.y);
  }
}
