import type { Slingshot } from './aim';
import { SIM } from './config';
import { collideCircle } from './shapes';
import type { Duck } from './types';
import type { World } from './world';

/**
 * Picks the shot the idle demo performs — the "what", with none of the "how".
 * Headless and pure: no Pixi, no wall clock, no animation. The view module
 * (src/game/idleDemo.ts) takes this answer and drags a hand along it.
 *
 * The shot is chosen the way tests/sim/bot.ts chooses one, because the demo has
 * to demonstrate the POINT of the mechanic and not merely the gesture: a shot
 * that visibly matches a pair or cracks a shell teaches what the board is for,
 * where a legal-but-aimless shot just shows a duck sliding about.
 */

/** how far behind the duck the pointer ends up — a player's pull, not a nudge */
const PULL_LEN = 150;
/** ...but never so short that the release would be read as a whiff */
const MIN_PULL_LEN = SIM.MIN_PULL + 20;
/**
 * Room the hand needs around the pull point, as a radius. The rig draws about
 * 31x51 design px at its shipped 0.25, so this keeps the whole of it off the
 * tub's rim and clear of the bumper wedges — a thumb resting half on the
 * moulding does not read as a gesture the viewer could copy.
 */
const HAND_CLEAR = 34;
/** how much shorter to try when the full pull would put the hand on the rim */
const PULL_STEP = 10;
/** one point of shot quality outranks any pull length — see chooseDemoShot */
const QUALITY_WEIGHT = 1000;

export interface DemoShot {
  /** the duck the hand grabs */
  duck: Duck;
  /** where the pointer must end up: the pull-back point, opposite the shot */
  pullTo: { x: number; y: number };
}

/**
 * The pull point for a shot along `(ux, uy)`: `PULL_LEN` behind the duck,
 * shortened until the hand would sit clear inside the water. Direction is all
 * the sling reads from a pull, so a shortened one aims identically — it just
 * looks like a smaller gesture, which is what a player with their thumb near
 * the rim does anyway.
 *
 * The test is the SIM'S OWN tub, not a rectangle guessed at here: the tub has
 * shoulders, rounded corners and two bumper wedges, and a margin big enough to
 * clear all of them everywhere would forbid most of the board. Reusing
 * collideCircle also means the hint cannot drift from the geometry it is drawn
 * over the next time the tub is reshaped.
 */
function pullPoint(duck: Duck, ux: number, uy: number): { x: number; y: number } | null {
  for (let len = PULL_LEN; len >= MIN_PULL_LEN; len -= PULL_STEP) {
    const x = duck.x - ux * len, y = duck.y - uy * len;
    if (!collideCircle(x, y, HAND_CLEAR)) return { x, y };
  }
  return null;
}

/**
 * Does a dead-on hit on `target` send it onward into a goal? The white
 * deflection arrow's own promise, and the same test the bot scores by: the
 * struck duck leaves along the line of centres, so a goal sitting on that line
 * within a duck's width is one this shot pays for.
 */
function caromsIntoGoal(world: World, from: Duck, target: Duck): boolean {
  const ux = target.x - from.x, uy = target.y - from.y;
  const len = Math.hypot(ux, uy) || 1;
  const dx = ux / len, dy = uy / len;
  const reaches = (gx: number, gy: number, r: number): boolean => {
    const bx = gx - target.x, by = gy - target.y;
    const along = bx * dx + by * dy;
    if (along <= 0 || along > 700) return false;
    return Math.abs(bx * dy - by * dx) < r + SIM.DUCK_R * 0.6;
  };
  return world.barrels.some((b) => reaches(b.x, b.y, SIM.BARREL_R))
    || world.clams.some((c) => c.active && reaches(c.x, c.y, SIM.CLAM_R));
}

/**
 * The best shot available right now, or null if the board offers none.
 *
 * DETERMINISTIC, and deliberately not seeded off world.rng: drawing from the
 * sim's stream would change which colours respawn, so a demo that fired would
 * deal a different board than one that did not. There is no need for noise
 * anyway — every demo shot changes the board, so the next best shot differs.
 *
 * EVERY candidate is validated by driving the real slingshot. Aim assist bends
 * the launch direction by up to ASSIST_CONE_DEG toward a neighbouring duck, and
 * `end()` refuses any release whose trajectory does not reach one — so a
 * direction picked geometrically and released hopefully is exactly how a demo
 * comes to whiff in front of the viewer. Asking the sling itself is the only
 * answer that cannot disagree with the release. Safe to do here because the
 * board is idle by definition when the demo is offered a turn: `begin` on an
 * un-aimed sling and `cancel` leave nothing behind.
 */
export function chooseDemoShot(world: World, sling: Slingshot): DemoShot | null {
  const grabbable = world.ducks.filter((d) => !d.live && !d.popping && !d.matched);
  let best: DemoShot | null = null;
  let bestScore = -Infinity;

  for (const duck of grabbable) {
    for (const target of world.ducks) {
      if (target.id === duck.id || target.popping) continue;
      const vx = target.x - duck.x, vy = target.y - duck.y;
      const len = Math.hypot(vx, vy);
      if (len === 0) continue;
      const quality = (caromsIntoGoal(world, duck, target) ? 3 : 0)
        + (target.colour === duck.colour ? 2 : 0);
      // the best this pair could possibly score, before the pull is worked out —
      // no point probing a trajectory for a shot that cannot win
      if (quality * QUALITY_WEIGHT + PULL_LEN <= bestScore) continue;
      const pullTo = pullPoint(duck, vx / len, vy / len);
      if (!pullTo) continue;
      // LONGER PULLS BREAK TIES, and only ties: the shot the demo picks has to
      // be worth watching first and easy to read second. But near a wall the
      // pull is clipped to whatever fits, and a hand that twitches 60px teaches
      // less than the same shot demonstrated with a full sweep — so among shots
      // that are equally worth taking, the biggest gesture wins.
      const score = quality * QUALITY_WEIGHT + Math.hypot(pullTo.x - duck.x, pullTo.y - duck.y);
      if (score <= bestScore) continue;
      if (!fires(sling, duck, pullTo)) continue;
      best = { duck, pullTo };
      bestScore = score;
    }
  }
  return best;
}

/** Would this exact gesture fire? Asked of the sling, not of the geometry. */
function fires(sling: Slingshot, duck: Duck, pullTo: { x: number; y: number }): boolean {
  if (!sling.begin(duck.x, duck.y)) return false;
  // begin() grabs the NEAREST duck within GRAB_R, which at zero distance is the
  // one we asked for — but a duck sitting on top of another would be ambiguous,
  // so the grab is checked rather than assumed
  const got = sling.pull?.duck.id === duck.id;
  sling.move(pullTo.x, pullTo.y);
  const ok = got && sling.preview()?.hitKind === 'duck';
  sling.cancel();
  return ok;
}
