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
  /** first duck or barrel the swept circle hits, or null. Only a 'duck' hit is
   *  a valid shot — anything else draws the red X and refuses the release. */
  hitId: number | null;
  hitKind: 'duck' | 'barrel' | null;
  /** unit direction the STRUCK DUCK will travel after impact (billiards normal), null unless hitKind==='duck' */
  deflect: { x: number; y: number } | null;
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
  kind: 'duck' | 'barrel';
  /** body centre — the struck body's position */
  cx: number;
  cy: number;
}

/** Nearest body overlapping a duck-sized circle at (x,y); null when clear. */
function bodyAt(world: World, shooter: Duck, x: number, y: number): BodyHit | null {
  for (const d of world.ducks) {
    if (d.id === shooter.id || d.popping) continue;
    if (Math.hypot(d.x - x, d.y - y) < SIM.DUCK_R * 2) {
      return { id: d.id, kind: 'duck', cx: d.x, cy: d.y };
    }
  }
  for (const b of world.barrels) {
    if (Math.hypot(b.x - x, b.y - y) < SIM.DUCK_R + SIM.BARREL_R) {
      return { id: b.id, kind: 'barrel', cx: b.x, cy: b.y };
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
  world: World, shooter: Duck,
  x: number, y: number, dx: number, dy: number, maxLen: number,
): LegResult {
  let px = x, py = y;
  for (let t = STEP; t <= maxLen; t += STEP) {
    const nx = x + dx * t;
    const ny = y + dy * t;
    const body = bodyAt(world, shooter, nx, ny);
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

/** Equal-mass billiards: the struck duck exits along the line of centres. */
function deflectOf(body: BodyHit, hitX: number, hitY: number): { x: number; y: number } | null {
  if (body.kind !== 'duck') return null;
  const vx = body.cx - hitX;
  const vy = body.cy - hitY;
  const len = Math.hypot(vx, vy) || 1;
  return { x: vx / len, y: vy / len };
}

/**
 * Project the shot: straight sweep, at most ONE wall bounce (official behaviour).
 * `dir` must be a unit vector.
 */
export function predictShot(
  world: World, shooter: Duck, dir: { x: number; y: number },
): AimPreview {
  const start = { x: shooter.x, y: shooter.y };
  const leg1 = sweep(world, shooter, start.x, start.y, dir.x, dir.y, LEG1_MAX);

  if (leg1.body) {
    return {
      points: [start, { x: leg1.x, y: leg1.y }],
      hitId: leg1.body.id,
      hitKind: leg1.body.kind,
      deflect: deflectOf(leg1.body, leg1.x, leg1.y),
    };
  }
  if (!leg1.wall) {
    return { points: [start, { x: leg1.x, y: leg1.y }], hitId: null, hitKind: null, deflect: null };
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
  const leg2 = sweep(world, shooter, sx, sy, ux, uy, LEG2_MAX);

  return {
    points: [start, wall, { x: leg2.x, y: leg2.y }],
    hitId: leg2.body ? leg2.body.id : null,
    hitKind: leg2.body ? leg2.body.kind : null,
    deflect: leg2.body ? deflectOf(leg2.body, leg2.x, leg2.y) : null,
  };
}
