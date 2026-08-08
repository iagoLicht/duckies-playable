import { SIM } from './config';
import { collideCircle } from './shapes';
import type { World } from './world';
import type { Duck } from './types';

/**
 * Aim preview — mirrors the official example's `cn`/`Bn` trajectory probe.
 * Pure TS (no Pixi) so it runs headless in tests.
 */
export interface AimPreview {
  /** polyline of the projected path: [start, ...] with 2 points (direct) or 3 (one wall bounce) */
  points: Array<{ x: number; y: number }>;
  /** first body the swept circle hits, or null. Only a 'duck' hit is a valid
   *  shot — anything else draws the red X and refuses the release. */
  hitId: number | null;
  hitKind: 'duck' | 'barrel' | 'clam' | null;
  /** unit direction the STRUCK DUCK will travel after impact (billiards normal), null unless hitKind==='duck' */
  deflect: { x: number; y: number } | null;
  /**
   * unit direction the SHOOTER continues in after impact — the snooker cue-ball
   * carom to `deflect`'s object-ball line. Null unless hitKind==='duck'.
   */
  carom: { x: number; y: number } | null;
  /**
   * Where that carom run ends: the next body/wall, or the range the shooter's
   * retained speed buys it. Null whenever `carom` is. The view continues the
   * dotted path from the contact point to here.
   */
  caromEnd: { x: number; y: number } | null;
  /**
   * The unit launch direction this preview was projected along, after aim assist.
   *
   * The view steers the sling rig by THIS, not by points[0]->points[1]: a leg
   * that ends on a wall reports collideCircle's corrected centre, which is off
   * the ray, so an angle read back off the path swung about as the aim crossed
   * between a duck, a wall and open water.
   */
  dir: { x: number; y: number };
}

/** march resolution of the swept circle, px */
const STEP = 6;
/** official 16 world units x 90 px/unit */
const LEG1_MAX = 1440;
/** official 11 world units x 90 px/unit */
const LEG2_MAX = 990;
/** push the reflected leg off the wall so the next sample isn't still in contact */
const WALL_NUDGE = 2;

interface BodyHit {
  id: number;
  kind: 'duck' | 'barrel' | 'clam';
  /** body centre — the struck body's position */
  cx: number;
  cy: number;
  /** centre separation at which the swept duck touches this body */
  r: number;
}

/**
 * Nearest body overlapping a duck-sized circle at (x,y); null when clear.
 * `skipA`/`skipB` are duck ids to ignore: the shooter always, and on the carom
 * leg the duck it has just struck (the pair is separating, so a contact the
 * sampler still reads as overlapping is the one we already resolved).
 */
function bodyAt(
  world: World, skipA: number, skipB: number, x: number, y: number,
): BodyHit | null {
  for (const d of world.ducks) {
    if (d.id === skipA || d.id === skipB || d.popping) continue;
    if (Math.hypot(d.x - x, d.y - y) < SIM.DUCK_R * 2) {
      return { id: d.id, kind: 'duck', cx: d.x, cy: d.y, r: SIM.DUCK_R * 2 };
    }
  }
  for (const b of world.barrels) {
    if (Math.hypot(b.x - x, b.y - y) < SIM.DUCK_R + SIM.BARREL_R) {
      return { id: b.id, kind: 'barrel', cx: b.x, cy: b.y, r: SIM.DUCK_R + SIM.BARREL_R };
    }
  }
  // clams are solid bumpers, open or shut — the guide has to stop on them
  for (const c of world.clams) {
    if (Math.hypot(c.x - x, c.y - y) < SIM.DUCK_R + SIM.CLAM_R) {
      return { id: c.id, kind: 'clam', cx: c.x, cy: c.y, r: SIM.DUCK_R + SIM.CLAM_R };
    }
  }
  return null;
}

interface LegResult {
  /** where the leg ended: body contact, wall contact, or max range */
  x: number;
  y: number;
  body: BodyHit | null;
  /** wall normal at contact when the leg ended on a wall/bumper */
  wall: { nx: number; ny: number } | null;
}

/** Sweep a DUCK_R circle from (x,y) along unit (dx,dy) until a body, a wall, or maxLen. */
function sweep(
  world: World, skipA: number, skipB: number,
  x: number, y: number, dx: number, dy: number, maxLen: number,
): LegResult {
  let px = x, py = y;
  for (let t = STEP; t <= maxLen; t += STEP) {
    const nx = x + dx * t;
    const ny = y + dy * t;
    const body = bodyAt(world, skipA, skipB, nx, ny);
    if (body) return { x: nx, y: ny, body, wall: null };
    const hit = collideCircle(nx, ny, SIM.DUCK_R);
    // only a contact we are moving INTO bounces — a shooter resting flush against
    // a wall can report contact on the first samples while aiming away from it
    if (hit && dx * hit.nx + dy * hit.ny < 0) {
      return { x: hit.x, y: hit.y, body: null, wall: { nx: hit.nx, ny: hit.ny } };
    }
    px = nx;
    py = ny;
  }
  return { x: px, y: py, body: null, wall: null };
}

/**
 * The exact contact point, replacing sweep()'s sampled one.
 *
 * sweep() marches in STEP-px jumps, so the sample that first reports overlap can
 * be most of a step past the moment the circles actually touch. On the path
 * itself that is invisible — the sample sits on the ray either way — but the
 * deflect is taken from the contact point to the body centre, so quantising the
 * contact quantises the arrow's ANGLE. Sweeping the aim then stepped the arrow
 * through jumps of a few degrees instead of turning it.
 *
 * Solving the ray/circle intersection instead puts the contact exactly on the
 * touching distance, which makes the normal — and so the arrow, the crescent and
 * the carom that all read it — a continuous function of the aim.
 *
 *   |S + t·u - C| = r   ->   t² - 2(w·u)t + (|w|² - r²) = 0,  w = C - S
 *
 * The near root is the first touch. A miss (negative discriminant) or a contact
 * behind the start can only mean the bodies already overlapped, which the sweep
 * cannot produce from a legal board — the sampled point stands in for those.
 */
function contactPoint(
  sx: number, sy: number, ux: number, uy: number,
  body: BodyHit, sampledX: number, sampledY: number,
): { x: number; y: number } {
  const wx = body.cx - sx, wy = body.cy - sy;
  const b = wx * ux + wy * uy;
  const disc = b * b - (wx * wx + wy * wy - body.r * body.r);
  if (disc < 0) return { x: sampledX, y: sampledY };
  const t = b - Math.sqrt(disc);
  if (!(t >= 0)) return { x: sampledX, y: sampledY };
  return { x: sx + ux * t, y: sy + uy * t };
}

/** Equal-mass billiards: the struck duck exits along the line of centres. */
function deflectOf(body: BodyHit, hitX: number, hitY: number): { x: number; y: number } | null {
  if (body.kind !== 'duck') return null;
  const vx = body.cx - hitX;
  const vy = body.cy - hitY;
  const len = Math.hypot(vx, vy) || 1;
  return { x: vx / len, y: vy / len };
}

/**
 * Where the SHOOTER goes on from the same contact — the cue-ball carom.
 *
 * This is World.collideDuckPairs' impulse solved for the striking duck, with
 * the target at rest (a preview only ever runs on a settled board), so the
 * guide can't drift from the physics it is predicting:
 *
 *   v' = v - (1 + sr)/2 · (v·n) · n     n = unit line of centres, sr = restitution
 *
 * At sr = 1 that is the pure tangent — snooker's 90-degree rule. At the game's
 * sr = 0.96 the shooter keeps a sliver of the normal component, so the carom
 * leans a couple of degrees forward of square. Same `n` as deflectOf, so the
 * two predictions always agree about where the contact was.
 */
function caromOf(
  body: BodyHit, hitX: number, hitY: number, dir: { x: number; y: number },
): { dir: { x: number; y: number }; keep: number } | null {
  if (body.kind !== 'duck') return null;
  const vx = body.cx - hitX;
  const vy = body.cy - hitY;
  const len = Math.hypot(vx, vy);
  if (len === 0) return null;
  const nx = vx / len, ny = vy / len;
  const vn = dir.x * nx + dir.y * ny;
  if (vn <= 0) return null; // not closing on it — no impulse to predict
  const k = ((1 + SIM.RESTITUTION_BODY) / 2) * vn;
  const ox = dir.x - k * nx;
  const oy = dir.y - k * ny;
  const olen = Math.hypot(ox, oy);
  // dead-centre at sr = 1: the shooter stops, and a stopped duck has no heading
  if (olen < 1e-9) return null;
  // `dir` is a unit vector, so olen IS the fraction of speed the shooter keeps
  return { dir: { x: ox / olen, y: oy / olen }, keep: olen };
}

/**
 * The shooter's carom as a drawable leg: heading from caromOf, run out to the
 * next body/wall.
 *
 * Range is LEG1_MAX scaled by the retained speed fraction. That is not a fudge:
 * World.step's drag is linear (v *= 1/(1+drag·dt)), so coast distance is
 * proportional to entry speed, and LEG1_MAX is already the probe range for a
 * full-speed shot. A glancing hit keeps nearly all its speed and draws nearly a
 * full lane; a near-head-on hit keeps almost none and draws a stub, which is
 * exactly what happens to a cue ball that hits square.
 *
 * The struck duck is skipped for this sweep: the impulse has separated the pair,
 * but the contact starts exactly ON 2R and a carom with any forward lean dips
 * back inside it for the first few samples, so a plain sweep would re-detect the
 * duck we just resolved against and return a zero-length leg.
 */
function caromLeg(
  world: World, shooter: Duck, body: BodyHit,
  hitX: number, hitY: number, dir: { x: number; y: number },
): Pick<AimPreview, 'carom' | 'caromEnd'> {
  const c = caromOf(body, hitX, hitY, dir);
  if (!c) return { carom: null, caromEnd: null };
  const leg = sweep(
    world, shooter.id, body.id, hitX, hitY, c.dir.x, c.dir.y, LEG1_MAX * c.keep,
  );
  return { carom: c.dir, caromEnd: { x: leg.x, y: leg.y } };
}

/**
 * Project the shot: straight sweep, at most ONE wall bounce (official behaviour).
 * `dir` must be a unit vector.
 */
export function predictShot(
  world: World, shooter: Duck, dir: { x: number; y: number },
): AimPreview {
  const start = { x: shooter.x, y: shooter.y };
  const leg1 = sweep(world, shooter.id, -1, start.x, start.y, dir.x, dir.y, LEG1_MAX);

  if (leg1.body) {
    const c = contactPoint(start.x, start.y, dir.x, dir.y, leg1.body, leg1.x, leg1.y);
    return {
      points: [start, c],
      hitId: leg1.body.id,
      hitKind: leg1.body.kind,
      deflect: deflectOf(leg1.body, c.x, c.y),
      ...caromLeg(world, shooter, leg1.body, c.x, c.y, dir),
      dir,
    };
  }
  if (!leg1.wall) {
    return {
      points: [start, { x: leg1.x, y: leg1.y }],
      hitId: null, hitKind: null, deflect: null, carom: null, caromEnd: null, dir,
    };
  }

  // reflect about the wall normal and sweep one more leg
  const { nx, ny } = leg1.wall;
  const dot = dir.x * nx + dir.y * ny;
  const rx = dir.x - 2 * dot * nx;
  const ry = dir.y - 2 * dot * ny;
  const rlen = Math.hypot(rx, ry) || 1;
  const ux = rx / rlen, uy = ry / rlen;
  const wall = { x: leg1.x, y: leg1.y };
  const sx = wall.x + nx * WALL_NUDGE;
  const sy = wall.y + ny * WALL_NUDGE;
  const leg2 = sweep(world, shooter.id, -1, sx, sy, ux, uy, LEG2_MAX);
  const c2 = leg2.body
    ? contactPoint(sx, sy, ux, uy, leg2.body, leg2.x, leg2.y)
    : { x: leg2.x, y: leg2.y };

  return {
    points: [start, wall, c2],
    hitId: leg2.body ? leg2.body.id : null,
    hitKind: leg2.body ? leg2.body.kind : null,
    deflect: leg2.body ? deflectOf(leg2.body, c2.x, c2.y) : null,
    // post-bounce heading, not the original aim — the shooter arrives on (ux,uy)
    ...(leg2.body
      ? caromLeg(world, shooter, leg2.body, c2.x, c2.y, { x: ux, y: uy })
      : { carom: null, caromEnd: null }),
    dir,
  };
}
