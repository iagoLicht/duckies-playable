# Phase B — Gameplay Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the approved static scene into a playable Duckies Pop level: pull-back slingshot ducks, same-colour pair explosions with colour-carrying chain blasts, barrel HP with clasp-strip stages, wave progression with a "x/13" counter, and a rigged "barely win with the final duck" ending — proven by a ~600-run headless playthrough test.

**Architecture:** A pure-TypeScript deterministic simulation (`src/sim/`) with zero PixiJS imports — fixed timestep, seeded RNG, event queue out. A thin view layer (`src/game/`) binds existing Spine rigs to sim bodies and feeds pointer input in. Vitest runs the sim headless: unit tests per mechanic plus a bot-driven statistical playthrough harness that asserts win rate, duration, and finale behaviour.

**Tech Stack:** TypeScript strict, Vitest (new dev dep), existing PixiJS v8 + spine-pixi-v8 view code, existing Vite single-file build.

**Locked design inputs (do not re-derive):**
- Only move: pull-back slingshot drag (pointer starts on a duck, pull away, release fires opposite).
- Two same-colour ducks collide at speed → both explode. A blast has a colour; ducks in radius react as if hit by that colour → chains propagate through same-colour ducks only. Blasts damage ALL barrels in radius regardless of colour.
- Barrels: damaged by blasts AND direct duck impacts (any colour). Wood barrels 2 HP, colour barrels 2 HP, golden finale barrel 3 HP (uses the `yellow` crate-round skin — there is no gold skin).
- NO fireworks (cut by user decision 2026-08-02).
- Whiffs (release with tiny pull) fire nothing and cost nothing.
- No visible timer; target level length ≈ 40 s; win-only; ending = "barely win with the final duck".
- Scene layout (locked, from `src/main.ts`): ducks green(175,360) red(455,345) yellow(285,485) green(550,470) (purple duck changed to green 2026-08-02, user-approved: 4 distinct colours made the chain mechanic unreachable); colour barrels yellow(250,800) red(470,800); wood barrels ×4 at (120/285/450/615, 1090); triangle bumpers on walls at y=950 (flat edge at x=50 / x=670); tub interior boundary = `traceTub` shape.
- THE barrel rig is `entities/crate-round` (skins wood/yellow/purple/red; anims `hp5..hp0` = clasp-strip set-poses, `hit` = 1.03 s wobble).

---

## File Structure

```
src/sim/rng.ts          seeded deterministic RNG (mulberry32)
src/sim/config.ts       every tunable constant in one place
src/sim/types.ts        Colour, bodies, events — no logic
src/sim/shapes.ts       tub boundary polygon + bumper polygons + circle collision vs polylines
src/sim/world.ts        bodies, fixed-step integration, collisions, pops/blasts/chains, event queue
src/sim/aim.ts          Slingshot controller (begin/move/end) + aim assist
src/sim/director.ts     waves, counter, respawns, assist ramp, finale rigging, win
src/game/scene.ts       view layer: binds spines/sprites to sim, drains events, pointer input
src/main.ts             (rework) boots environment + scene instead of the static showcase
tests/sim/*.test.ts     unit tests per module
tests/sim/playthrough.test.ts  bot + ~600-run statistics harness
```

The existing visual construction in `main.ts` (bg tile, water, ring, frame, bumper sprites) is kept as-is and moves mostly unchanged into `boot()`; only the *entity* showcase (ducks/barrels/hand rows) is replaced by the live scene.

**Conventions for every task below:** run commands from `C:\dev\duckies-playable`. Test command is `npx vitest run <file>` (or `npm test` once wired). Type-check is included in `npm run build`; for speed use `npx tsc --noEmit` after each task. Commit after each green task with the message given.

---

### Task 1: Vitest + RNG + config + types

**Files:**
- Modify: `package.json`
- Create: `src/sim/rng.ts`, `src/sim/config.ts`, `src/sim/types.ts`
- Test: `tests/sim/rng.test.ts`

- [ ] **Step 1.1: Install vitest and add the test script**

Run: `npm i -D vitest@^3`
Then edit `package.json` scripts, adding:

```json
"test": "vitest run"
```

- [ ] **Step 1.2: Write the failing RNG test**

Create `tests/sim/rng.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/sim/rng';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('produces values in [0, 1) with different seeds diverging', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(a()).not.toEqual(b());
  });
});
```

Run: `npx vitest run tests/sim/rng.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 1.3: Implement rng, config, types**

Create `src/sim/rng.ts`:

```ts
export type Rng = () => number;

/** Deterministic seeded RNG — the whole sim must draw randomness ONLY from this. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

Create `src/sim/config.ts`:

```ts
/** All tunables. Units: design px (720x1280 stage), seconds, px/s. */
export const SIM = {
  DT: 1 / 60,
  SUBSTEPS: 4,

  DUCK_R: 46,
  BARREL_R: 60,

  FRICTION: 0.6,        // exponential damping per second while live
  STOP_SPEED: 30,       // below this a live duck comes to rest
  RESTITUTION_WALL: 0.82,
  RESTITUTION_BODY: 0.95,

  GRAB_R: 80,           // pointer-to-duck pickup radius
  MIN_PULL: 25,         // below this, release is a whiff (no shot)
  MAX_PULL: 200,
  LAUNCH_K: 7.0,        // launch speed = pull-length * LAUNCH_K

  POP_SPEED: 120,       // min relative speed for a same-colour pair pop
  BARREL_HIT_SPEED: 90, // min impact speed for a direct hit to damage a barrel
  BLAST_R: 140,
  CHAIN_DELAY: 0.08,    // seconds between chain hops (readability)

  RESPAWN_DELAY: 0.6,
  ASSIST_CONE_DEG: 28,
} as const;

/** Level data — mirrors the locked visual layout for wave 1. */
export const LEVEL = {
  DUCKS: [
    { colour: 'green', x: 175, y: 360 },
    { colour: 'red', x: 455, y: 345 },
    { colour: 'yellow', x: 285, y: 485 },
    { colour: 'green', x: 550, y: 470 },
  ],
  WAVES: [
    {
      assist: 0.35,
      targetDucks: 4,
      barrels: [
        { skin: 'yellow', x: 250, y: 800, hp: 2 },
        { skin: 'red', x: 470, y: 800, hp: 2 },
        { skin: 'wood', x: 120, y: 1090, hp: 2 },
        { skin: 'wood', x: 285, y: 1090, hp: 2 },
        { skin: 'wood', x: 450, y: 1090, hp: 2 },
        { skin: 'wood', x: 615, y: 1090, hp: 2 },
      ],
    },
    {
      assist: 0.55,
      targetDucks: 4,
      barrels: [
        { skin: 'purple', x: 250, y: 620, hp: 2 },
        { skin: 'red', x: 470, y: 620, hp: 2 },
        { skin: 'wood', x: 120, y: 640, hp: 2 },
        { skin: 'wood', x: 615, y: 640, hp: 2 },
        { skin: 'wood', x: 250, y: 1090, hp: 2 },
        { skin: 'wood', x: 470, y: 1090, hp: 2 },
      ],
    },
    {
      assist: 0.85,
      targetDucks: 2,
      barrels: [{ skin: 'yellow', x: 360, y: 700, hp: 3, golden: true }],
    },
  ],
  TOTAL_BARRELS: 13,
  ASSIST_FINALE: 0.95,
  DUCK_SPAWN_REGION: { x0: 110, y0: 300, x1: 610, y1: 560 },
} as const;
```

(Wave-2 wood barrels at y=640 sit clear of wave-1 positions; layout keeps the bumper lane at y=950 open so bank shots stay possible.)

Create `src/sim/types.ts`:

```ts
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
  /** set while a chain pop is scheduled so it can't be double-queued */
  popping: boolean;
}

export interface Barrel {
  id: number;
  kind: 'barrel';
  skin: 'wood' | 'yellow' | 'purple' | 'red';
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  golden: boolean;
}

export type SimEvent =
  | { type: 'duckLaunched'; id: number }
  | { type: 'duckStopped'; id: number }
  | { type: 'duckPopped'; id: number; colour: Colour; x: number; y: number }
  | { type: 'blast'; colour: Colour; x: number; y: number; r: number }
  | { type: 'duckSpawned'; duck: Duck }
  | { type: 'barrelDamaged'; id: number; hp: number }
  | { type: 'barrelDestroyed'; id: number; x: number; y: number }
  | { type: 'barrelSpawned'; barrel: Barrel }
  | { type: 'waveStarted'; wave: number }
  | { type: 'counter'; done: number; total: number }
  | { type: 'finaleArmed' }
  | { type: 'won' };
```

- [ ] **Step 1.4: Run the test — green — and commit**

Run: `npx vitest run tests/sim/rng.test.ts` — Expected: PASS.
Run: `npx tsc --noEmit` — Expected: clean.

```bash
git add -A
git commit -m "feat(sim): vitest harness, seeded rng, config and types"
```

---

### Task 2: Collision shapes — tub boundary + bumper polygons

**Files:**
- Create: `src/sim/shapes.ts`
- Test: `tests/sim/shapes.test.ts`

The sim needs the same tub geometry the renderer draws. `shapes.ts` re-implements the sampled boundary (self-contained, no dependency on main.ts — geometry constants are duplicated deliberately and a comment cross-references them).

- [ ] **Step 2.1: Write the failing shapes test**

Create `tests/sim/shapes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { collideCircle, COLLIDERS } from '../../src/sim/shapes';

describe('tub boundary collision', () => {
  it('does nothing for a circle well inside', () => {
    expect(collideCircle(360, 700, 46)).toBeNull();
  });

  it('pushes a circle back inside through the left wall', () => {
    const hit = collideCircle(30, 700, 46);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeGreaterThan(30);
    expect(hit!.nx).toBeGreaterThan(0.9); // normal points inward (+x)
  });

  it('pushes back at the bottom edge', () => {
    const hit = collideCircle(360, 1265, 46);
    expect(hit).not.toBeNull();
    expect(hit!.y).toBeLessThan(1265);
    expect(hit!.ny).toBeLessThan(-0.9);
  });

  it('collides with the top-right shoulder region', () => {
    const hit = collideCircle(660, 230, 46);
    expect(hit).not.toBeNull();
  });

  it('collides with the left bumper triangle', () => {
    const hit = collideCircle(120, 950, 46);
    expect(hit).not.toBeNull();
    expect(hit!.nx).toBeGreaterThan(0.3); // deflects rightward off the tip slope
  });

  it('registers bumper hits with source=bumper', () => {
    const hit = collideCircle(120, 950, 46);
    expect(hit!.source).toBe('bumper');
  });

  it('boundary hits report source=wall', () => {
    expect(collideCircle(30, 700, 46)!.source).toBe('wall');
  });
});
```

Run: `npx vitest run tests/sim/shapes.test.ts` — Expected: FAIL.

- [ ] **Step 2.2: Implement shapes.ts**

Create `src/sim/shapes.ts`:

```ts
/**
 * Collision geometry. The tub boundary duplicates the visual `traceTub` shape in
 * src/main.ts (tub rect l26 t200 r694 b1254, shoulders s52 d60, rc18, rb46) —
 * sampled as a dense polygon at the INNER FACE (offset 20 from centerline: the
 * navy edge is at 15, ducks visually overlap the white ring a touch, matching
 * the reference playable). If main.ts geometry changes, change this too.
 */
export interface Hit {
  x: number;
  y: number;
  nx: number;
  ny: number;
  source: 'wall' | 'bumper';
}

const TUB = { l: 26, t: 200, r: 694, b: 1254, s: 52, d: 60 };
const INSET = 20;

function sampleTub(o: number): Array<{ x: number; y: number }> {
  const l = TUB.l + o, t = TUB.t + o, r = TUB.r - o, b = TUB.b - o;
  const { s, d } = TUB;
  const rc = 18;
  const rb = 46 - o;
  const pts: Array<{ x: number; y: number }> = [];
  const line = (x1: number, y1: number, x2: number, y2: number): void => {
    const n = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 14));
    for (let i = 0; i < n; i++) pts.push({ x: x1 + ((x2 - x1) * i) / n, y: y1 + ((y2 - y1) * i) / n });
  };
  const arc = (cx: number, cy: number, rad: number, a1: number, a2: number): void => {
    for (let i = 0; i < 10; i++) {
      const a = a1 + ((a2 - a1) * i) / 10;
      pts.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) });
    }
  };
  const bez = (
    p0: [number, number], c1: [number, number], c2: [number, number], p1: [number, number],
  ): void => {
    for (let i = 0; i < 12; i++) {
      const u = i / 12, v = 1 - u;
      pts.push({
        x: v * v * v * p0[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * p1[0],
        y: v * v * v * p0[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * p1[1],
      });
    }
  };
  const H = Math.PI / 2;
  line(l + s + rc, t, r - s - rc, t);
  arc(r - s - rc, t + rc, rc, -H, 0);
  line(r - s, t + rc, r - s, t + d - rc);
  bez([r - s, t + d - rc], [r - s, t + d + 18], [r, t + d], [r, t + d + 26]);
  line(r, t + d + 26, r, b - rb);
  arc(r - rb, b - rb, rb, 0, H);
  line(r - rb, b, l + rb, b);
  arc(l + rb, b - rb, rb, H, 2 * H);
  line(l, b - rb, l, t + d + 26);
  bez([l, t + d + 26], [l, t + d], [l + s, t + d + 18], [l + s, t + d - rc]);
  line(l + s, t + d - rc, l + s, t + rc);
  arc(l + s + rc, t + rc, rc, 2 * H, 3 * H);
  return pts;
}

/** Bumper triangles (flat edge on the wall at x=50 / x=670, tip pointing in). */
const LEFT_BUMPER = [
  { x: 50, y: 950 - 58 },
  { x: 50 + 78, y: 950 },
  { x: 50, y: 950 + 58 },
];
const RIGHT_BUMPER = LEFT_BUMPER.map((p) => ({ x: 720 - p.x, y: p.y }));

interface Collider {
  pts: Array<{ x: number; y: number }>;
  closed: boolean;
  source: 'wall' | 'bumper';
  /** 'inside' keeps the circle inside the loop; 'outside' pushes it away */
  mode: 'inside' | 'outside';
}

export const COLLIDERS: Collider[] = [
  { pts: sampleTub(INSET), closed: true, source: 'wall', mode: 'inside' },
  { pts: LEFT_BUMPER, closed: true, source: 'bumper', mode: 'outside' },
  { pts: RIGHT_BUMPER, closed: true, source: 'bumper', mode: 'outside' },
];

function closestOnSegment(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): { x: number; y: number } {
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby || 1;
  let t = ((px - ax) * abx + (py - ay) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: ax + abx * t, y: ay + aby * t };
}

function pointInPolygon(px: number, py: number, pts: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!, b = pts[j]!;
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Test a circle against every collider. Returns the corrected centre plus the
 * contact normal (pointing into free space), or null when unobstructed.
 * Resolves ONE contact per call — callers iterate (substeps make this stable).
 */
export function collideCircle(x: number, y: number, r: number): Hit | null {
  for (const col of COLLIDERS) {
    // nearest boundary point across all segments
    let best: { x: number; y: number } | null = null;
    let bestD2 = Infinity;
    const n = col.pts.length;
    const last = col.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = col.pts[i]!;
      const b = col.pts[(i + 1) % n]!;
      const c = closestOnSegment(x, y, a.x, a.y, b.x, b.y);
      const d2 = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = c;
      }
    }
    if (!best) continue;
    const d = Math.sqrt(bestD2);
    const inside = pointInPolygon(x, y, col.pts);
    if (col.mode === 'inside') {
      // must stay inside the loop, at least r from the boundary
      if (!inside || d < r) {
        let nx = x - best.x, ny = y - best.y;
        if (!inside) { nx = -nx; ny = -ny; }
        const len = Math.hypot(nx, ny) || 1;
        nx /= len; ny /= len;
        return { x: best.x + nx * r, y: best.y + ny * r, nx, ny, source: col.source };
      }
    } else {
      // must stay outside the loop, at least r from the boundary
      if (inside || d < r) {
        let nx = x - best.x, ny = y - best.y;
        if (inside) { nx = -nx; ny = -ny; }
        const len = Math.hypot(nx, ny) || 1;
        nx /= len; ny /= len;
        return { x: best.x + nx * r, y: best.y + ny * r, nx, ny, source: col.source };
      }
    }
  }
  return null;
}
```

- [ ] **Step 2.3: Run tests — green — commit**

Run: `npx vitest run tests/sim/shapes.test.ts` — Expected: PASS.
Run: `npx tsc --noEmit` — Expected: clean.

```bash
git add -A
git commit -m "feat(sim): tub boundary + bumper collision geometry"
```

---

### Task 3: World — motion, wall bounce, body collisions

**Files:**
- Create: `src/sim/world.ts`
- Test: `tests/sim/world.test.ts`

- [ ] **Step 3.1: Write the failing world tests**

Create `tests/sim/world.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SIM } from '../../src/sim/config';
import { World } from '../../src/sim/world';

const mk = (): World => new World(42);

describe('World motion', () => {
  it('a launched duck slows down and eventually stops (friction)', () => {
    const w = mk();
    const d = w.spawnDuck('red', 360, 700);
    w.launch(d.id, 800, 0);
    expect(d.live).toBe(true);
    for (let i = 0; i < 60 * 6; i++) w.step(SIM.DT);
    expect(Math.hypot(d.vx, d.vy)).toBe(0);
    expect(d.live).toBe(false);
  });

  it('bounces off the right wall and reverses vx', () => {
    const w = mk();
    const d = w.spawnDuck('red', 600, 700);
    w.launch(d.id, 1200, 0);
    for (let i = 0; i < 30; i++) w.step(SIM.DT);
    expect(d.vx).toBeLessThan(0);
    expect(d.x).toBeLessThan(694 - 20);
  });

  it('two different-colour ducks bounce apart without popping', () => {
    const w = mk();
    const a = w.spawnDuck('red', 300, 700);
    const b = w.spawnDuck('green', 460, 700);
    w.launch(a.id, 900, 0);
    let transferred = false;
    for (let i = 0; i < 90; i++) { w.step(SIM.DT); if (b.vx > 0) transferred = true; }
    expect(w.ducks).toHaveLength(2);
    expect(transferred).toBe(true); // momentum transferred
  });

  it('duck hitting a barrel bounces back and damages it', () => {
    const w = mk();
    const barrel = w.spawnBarrel('wood', 500, 700, 2);
    const d = w.spawnDuck('red', 300, 700);
    w.launch(d.id, 1000, 0);
    // window ends after the rebound but before the duck can return off the wall
    // for a second contact (FRICTION 0.6 keeps it live far longer than 1.5 s)
    for (let i = 0; i < 30; i++) w.step(SIM.DT);
    expect(barrel.hp).toBe(1);
    expect(d.vx).toBeLessThan(0); // bounced back
    expect(d.x).toBeLessThan(500 - 46); // did not tunnel through
    const evs = w.events.filter((e) => e.type === 'barrelDamaged');
    expect(evs).toHaveLength(1);
  });

  it('a slow drifting duck does NOT damage a barrel', () => {
    const w = mk();
    const barrel = w.spawnBarrel('wood', 420, 700, 2);
    const d = w.spawnDuck('red', 320, 700);
    d.vx = 60; // below BARREL_HIT_SPEED, not launched
    for (let i = 0; i < 120; i++) w.step(SIM.DT);
    expect(barrel.hp).toBe(2);
  });
});
```

(Momentum is sampled over the window: duck B round-trips off the right wall and returns with negative vx by frame 90 — asserting `b.vx > 0` at the end is unsatisfiable.)

Run: `npx vitest run tests/sim/world.test.ts` — Expected: FAIL.

- [ ] **Step 3.2: Implement World (motion + collisions only; pops arrive in Task 4)**

Create `src/sim/world.ts`:

```ts
import { SIM } from './config';
import { mulberry32, type Rng } from './rng';
import { collideCircle } from './shapes';
import type { Barrel, Colour, Duck, SimEvent } from './types';

/**
 * Pure simulation world. Deterministic: all randomness via the seeded rng,
 * fixed-timestep stepping only. Emits SimEvents into `events`; the caller
 * (view or test) drains the array each frame.
 */
export class World {
  readonly rng: Rng;
  readonly ducks: Duck[] = [];
  readonly barrels: Barrel[] = [];
  readonly events: SimEvent[] = [];
  time = 0;
  private nextId = 1;
  /** scheduled chain pops: duck id -> sim time to pop */
  private popQueue: Array<{ id: number; at: number }> = [];

  constructor(seed: number) {
    this.rng = mulberry32(seed);
  }

  spawnDuck(colour: Colour, x: number, y: number): Duck {
    const d: Duck = {
      id: this.nextId++, kind: 'duck', colour, x, y, vx: 0, vy: 0,
      live: false, popping: false,
    };
    this.ducks.push(d);
    this.events.push({ type: 'duckSpawned', duck: d });
    return d;
  }

  spawnBarrel(skin: Barrel['skin'], x: number, y: number, hp: number, golden = false): Barrel {
    const b: Barrel = { id: this.nextId++, kind: 'barrel', skin, x, y, hp, maxHp: hp, golden };
    this.barrels.push(b);
    this.events.push({ type: 'barrelSpawned', barrel: b });
    return b;
  }

  launch(id: number, vx: number, vy: number): void {
    const d = this.ducks.find((k) => k.id === id);
    if (!d) return;
    d.vx = vx;
    d.vy = vy;
    d.live = true;
    this.events.push({ type: 'duckLaunched', id });
  }

  step(dt: number): void {
    this.time += dt;
    this.processPopQueue();

    const damp = Math.exp(-SIM.FRICTION * dt);
    for (const d of this.ducks) {
      d.vx *= damp;
      d.vy *= damp;
      if (d.live && Math.hypot(d.vx, d.vy) < SIM.STOP_SPEED) {
        d.vx = 0;
        d.vy = 0;
        d.live = false;
        this.events.push({ type: 'duckStopped', id: d.id });
      }
    }

    const h = dt / SIM.SUBSTEPS;
    for (let s = 0; s < SIM.SUBSTEPS; s++) {
      for (const d of this.ducks) {
        d.x += d.vx * h;
        d.y += d.vy * h;
      }
      this.collideWalls();
      this.collideDuckPairs();
      this.collideDuckBarrels();
    }
  }

  private collideWalls(): void {
    for (const d of this.ducks) {
      const hit = collideCircle(d.x, d.y, SIM.DUCK_R);
      if (!hit) continue;
      d.x = hit.x;
      d.y = hit.y;
      const vn = d.vx * hit.nx + d.vy * hit.ny;
      if (vn < 0) {
        d.vx -= (1 + SIM.RESTITUTION_WALL) * vn * hit.nx;
        d.vy -= (1 + SIM.RESTITUTION_WALL) * vn * hit.ny;
      }
    }
  }

  private collideDuckPairs(): void {
    for (let i = 0; i < this.ducks.length; i++) {
      for (let j = i + 1; j < this.ducks.length; j++) {
        const a = this.ducks[i]!, b = this.ducks[j]!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const minD = SIM.DUCK_R * 2;
        if (dist >= minD || dist === 0) continue;
        const nx = dx / dist, ny = dy / dist;
        // separate equally
        const push = (minD - dist) / 2;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
        // relative velocity along the normal
        const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
        const rel = rvx * nx + rvy * ny;
        if (rel < 0) {
          const imp = (-(1 + SIM.RESTITUTION_BODY) * rel) / 2;
          a.vx -= imp * nx; a.vy -= imp * ny;
          b.vx += imp * nx; b.vy += imp * ny;
        }
        this.onDuckContact(a, b, Math.abs(rel));
      }
    }
  }

  /** Same-colour pop hook — implemented in Task 4 (no-op until then). */
  protected onDuckContact(_a: Duck, _b: Duck, _relSpeed: number): void {}

  private collideDuckBarrels(): void {
    for (const d of this.ducks) {
      for (const b of this.barrels) {
        const dx = d.x - b.x, dy = d.y - b.y;
        const dist = Math.hypot(dx, dy);
        const minD = SIM.DUCK_R + SIM.BARREL_R;
        if (dist >= minD || dist === 0) continue;
        const nx = dx / dist, ny = dy / dist;
        d.x = b.x + nx * minD;
        d.y = b.y + ny * minD;
        const vn = d.vx * nx + d.vy * ny;
        const impact = Math.abs(vn);
        if (vn < 0) {
          d.vx -= (1 + SIM.RESTITUTION_WALL) * vn * nx;
          d.vy -= (1 + SIM.RESTITUTION_WALL) * vn * ny;
        }
        if (d.live && impact > SIM.BARREL_HIT_SPEED) {
          this.damageBarrel(b, 1);
        }
      }
    }
  }

  damageBarrel(b: Barrel, amount: number): void {
    if (b.hp <= 0) return;
    b.hp = Math.max(0, b.hp - amount);
    if (b.hp === 0) {
      const idx = this.barrels.indexOf(b);
      if (idx >= 0) this.barrels.splice(idx, 1);
      this.events.push({ type: 'barrelDestroyed', id: b.id, x: b.x, y: b.y });
    } else {
      this.events.push({ type: 'barrelDamaged', id: b.id, hp: b.hp });
    }
  }

  /** Chain-pop scheduling — populated in Task 4. */
  protected processPopQueue(): void {}
}
```

Note for the implementer: `onDuckContact` / `processPopQueue` are protected virtual seams filled in by Task 4 **in this same class** (Task 4 edits world.ts directly rather than subclassing — the seam exists so Task 3 tests stay green while the file grows).

- [ ] **Step 3.3: Run tests — green — commit**

Run: `npx vitest run tests/sim/world.test.ts tests/sim/shapes.test.ts` — Expected: PASS.
Run: `npx tsc --noEmit` — Expected: clean.

```bash
git add -A
git commit -m "feat(sim): world motion, wall/bumper bounce, duck and barrel collisions"
```

---

### Task 4: Pops, blasts, chains

**Files:**
- Modify: `src/sim/world.ts`
- Test: `tests/sim/chains.test.ts`

- [ ] **Step 4.1: Write the failing chain tests**

Create `tests/sim/chains.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SIM } from '../../src/sim/config';
import { World } from '../../src/sim/world';

const settle = (w: World, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds * 60); i++) w.step(SIM.DT);
};

describe('same-colour pops and chain blasts', () => {
  it('two same-colour ducks colliding at speed both pop and emit a blast', () => {
    const w = new World(1);
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('red', 460, 700);
    w.launch(a.id, 900, 0);
    settle(w, 1.5);
    expect(w.ducks).toHaveLength(0);
    const pops = w.events.filter((e) => e.type === 'duckPopped');
    expect(pops).toHaveLength(2);
    expect(w.events.some((e) => e.type === 'blast' && e.colour === 'red')).toBe(true);
  });

  it('different colours never pop', () => {
    const w = new World(1);
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('green', 460, 700);
    w.launch(a.id, 900, 0);
    settle(w, 2);
    expect(w.ducks).toHaveLength(2);
  });

  it('blast chains through same-colour ducks only', () => {
    const w = new World(1);
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('red', 440, 700);
    // third red inside blast radius of the pair's midpoint
    w.spawnDuck('red', 480, 800);
    // green nearby must survive
    const green = w.spawnDuck('green', 350, 810);
    w.launch(a.id, 900, 0);
    settle(w, 2);
    expect(w.ducks).toHaveLength(1);
    expect(w.ducks[0]!.id).toBe(green.id);
    expect(w.events.filter((e) => e.type === 'blast').length).toBeGreaterThanOrEqual(2);
  });

  it('blasts damage barrels of any colour in radius', () => {
    const w = new World(1);
    const barrel = w.spawnBarrel('purple', 380, 810, 3);
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('red', 460, 700);
    w.launch(a.id, 900, 0);
    settle(w, 1.5);
    expect(barrel.hp).toBe(1);
  });

  it('a stationary pair does not spontaneously pop', () => {
    const w = new World(1);
    w.spawnDuck('red', 300, 700);
    w.spawnDuck('red', 300 + SIM.DUCK_R * 2 + 1, 700);
    settle(w, 2);
    expect(w.ducks).toHaveLength(2);
  });
});
```

(barrel hp 3: a pair pop emits TWO blasts — one per duck — and both reach the barrel at (380,810), so hp2 would be destroyed; hp3→1 pins the exact two-blast damage total)

Run: `npx vitest run tests/sim/chains.test.ts` — Expected: FAIL.

- [ ] **Step 4.2: Implement pops/blasts/chains in world.ts**

In `src/sim/world.ts`, replace the two protected seams and add the pop/blast logic:

Replace `protected onDuckContact(_a: Duck, _b: Duck, _relSpeed: number): void {}` with:

```ts
  protected onDuckContact(a: Duck, b: Duck, relSpeed: number): void {
    if (a.colour !== b.colour) return;
    if (a.popping || b.popping) return;
    if (!a.live && !b.live) return;
    if (relSpeed < SIM.POP_SPEED) return;
    this.schedulePop(a, 0);
    this.schedulePop(b, 0);
  }

  private schedulePop(d: Duck, delay: number): void {
    if (d.popping) return;
    d.popping = true;
    this.popQueue.push({ id: d.id, at: this.time + delay });
  }
```

Replace `protected processPopQueue(): void {}` with:

```ts
  protected processPopQueue(): void {
    if (this.popQueue.length === 0) return;
    const due = this.popQueue.filter((p) => p.at <= this.time);
    this.popQueue = this.popQueue.filter((p) => p.at > this.time);
    for (const p of due) {
      const idx = this.ducks.findIndex((d) => d.id === p.id);
      if (idx < 0) continue;
      const d = this.ducks[idx]!;
      this.ducks.splice(idx, 1);
      this.events.push({ type: 'duckPopped', id: d.id, colour: d.colour, x: d.x, y: d.y });
      this.blast(d.colour, d.x, d.y);
    }
  }

  blast(colour: Colour, x: number, y: number): void {
    this.events.push({ type: 'blast', colour, x, y, r: SIM.BLAST_R });
    for (const d of this.ducks) {
      if (d.colour !== colour || d.popping) continue;
      if (Math.hypot(d.x - x, d.y - y) <= SIM.BLAST_R + SIM.DUCK_R) {
        this.schedulePop(d, SIM.CHAIN_DELAY);
      }
    }
    for (const b of [...this.barrels]) {
      if (Math.hypot(b.x - x, b.y - y) <= SIM.BLAST_R + SIM.BARREL_R) {
        this.damageBarrel(b, 1);
      }
    }
  }
```

(`Colour` is already imported via the types import.)

- [ ] **Step 4.3: Run all sim tests — green — commit**

Run: `npx vitest run tests/sim` — Expected: PASS (rng, shapes, world, chains).
Run: `npx tsc --noEmit` — Expected: clean.

```bash
git add -A
git commit -m "feat(sim): same-colour pops, colour-carrying blasts, chain propagation"
```

---

### Task 5: Slingshot + aim assist

**Files:**
- Create: `src/sim/aim.ts`
- Test: `tests/sim/aim.test.ts`

- [ ] **Step 5.1: Write the failing aim tests**

Create `tests/sim/aim.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Slingshot } from '../../src/sim/aim';
import { SIM } from '../../src/sim/config';
import { World } from '../../src/sim/world';

describe('Slingshot', () => {
  it('grabs the nearest duck within GRAB_R, ignores far taps', () => {
    const w = new World(1);
    w.spawnDuck('red', 300, 700);
    const s = new Slingshot(w);
    expect(s.begin(310, 710)).toBe(true);
    s.cancel();
    expect(s.begin(600, 300)).toBe(false);
  });

  it('tiny pull is a whiff: no launch, duck stays put', () => {
    const w = new World(1);
    const d = w.spawnDuck('red', 300, 700);
    const s = new Slingshot(w);
    s.begin(300, 700);
    s.move(310, 700); // pull 10 < MIN_PULL
    expect(s.end()).toBe(false);
    expect(d.live).toBe(false);
  });

  it('pull back fires the duck in the opposite direction', () => {
    const w = new World(1);
    const d = w.spawnDuck('red', 300, 700);
    const s = new Slingshot(w);
    s.begin(300, 700);
    s.move(300, 850); // pulled straight down 150
    expect(s.end()).toBe(true);
    expect(d.live).toBe(true);
    expect(d.vy).toBeLessThan(0); // fires up
    expect(Math.abs(d.vx)).toBeLessThan(1);
    expect(Math.hypot(d.vx, d.vy)).toBeCloseTo(150 * SIM.LAUNCH_K, 0);
  });

  it('pull length is clamped at MAX_PULL', () => {
    const w = new World(1);
    const d = w.spawnDuck('red', 300, 700);
    const s = new Slingshot(w);
    s.begin(300, 700);
    s.move(300, 700 + 500);
    s.end();
    expect(Math.hypot(d.vx, d.vy)).toBeCloseTo(SIM.MAX_PULL * SIM.LAUNCH_K, 0);
  });

  it('aim assist bends the shot toward a same-colour duck inside the cone', () => {
    const w = new World(1);
    const d = w.spawnDuck('red', 360, 900);
    w.spawnDuck('red', 460, 300); // up and to the right, ~9.5 deg off vertical
    const s = new Slingshot(w);
    s.assist = 1.0;
    s.begin(360, 900);
    s.move(360, 1050); // aim straight up
    s.end();
    expect(d.vx).toBeGreaterThan(50); // fully bent toward the target
  });

  it('assist 0 leaves the aim unchanged', () => {
    const w = new World(1);
    const d = w.spawnDuck('red', 360, 900);
    w.spawnDuck('red', 460, 300);
    const s = new Slingshot(w);
    s.assist = 0;
    s.begin(360, 900);
    s.move(360, 1050);
    s.end();
    expect(Math.abs(d.vx)).toBeLessThan(1);
  });
});
```

Run: `npx vitest run tests/sim/aim.test.ts` — Expected: FAIL.

- [ ] **Step 5.2: Implement aim.ts**

Create `src/sim/aim.ts`:

```ts
import { SIM } from './config';
import type { World } from './world';
import type { Duck } from './types';

/**
 * Pull-back slingshot: begin() on/near a duck, move() drags the pointer away,
 * end() fires opposite the pull. Aim assist bends the launch direction toward
 * the best target (same-colour duck or any barrel) within the assist cone.
 */
export class Slingshot {
  /** 0..1 — director raises this over the level */
  assist = 0.35;
  private duck: Duck | null = null;
  private px = 0;
  private py = 0;

  constructor(private world: World) {}

  get aiming(): boolean {
    return this.duck !== null;
  }

  /** Current pull vector for the view (aim UI). Null when not aiming. */
  get pull(): { duck: Duck; dx: number; dy: number; len: number } | null {
    if (!this.duck) return null;
    const dx = this.duck.x - this.px;
    const dy = this.duck.y - this.py;
    return { duck: this.duck, dx, dy, len: Math.hypot(dx, dy) };
  }

  begin(x: number, y: number): boolean {
    let best: Duck | null = null;
    let bestD: number = SIM.GRAB_R;
    for (const d of this.world.ducks) {
      if (d.live || d.popping) continue;
      const dist = Math.hypot(d.x - x, d.y - y);
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    if (!best) return false;
    this.duck = best;
    this.px = x;
    this.py = y;
    return true;
  }

  move(x: number, y: number): void {
    if (!this.duck) return;
    this.px = x;
    this.py = y;
  }

  cancel(): void {
    this.duck = null;
  }

  /** Returns true when a real shot was fired (false = whiff, costs nothing). */
  end(): boolean {
    const p = this.pull;
    this.duck = null;
    if (!p || p.len < SIM.MIN_PULL) return false;
    const len = Math.min(p.len, SIM.MAX_PULL);
    let dx = p.dx / p.len;
    let dy = p.dy / p.len;
    const bent = this.applyAssist(p.duck, dx, dy);
    dx = bent.dx;
    dy = bent.dy;
    this.world.launch(p.duck.id, dx * len * SIM.LAUNCH_K, dy * len * SIM.LAUNCH_K);
    return true;
  }

  private applyAssist(duck: Duck, dx: number, dy: number): { dx: number; dy: number } {
    if (this.assist <= 0) return { dx, dy };
    const cone = (SIM.ASSIST_CONE_DEG * Math.PI) / 180;
    let bestAngle = cone;
    let bestDir: { dx: number; dy: number } | null = null;
    const consider = (tx: number, ty: number): void => {
      const vx = tx - duck.x, vy = ty - duck.y;
      const len = Math.hypot(vx, vy) || 1;
      const ux = vx / len, uy = vy / len;
      const ang = Math.acos(Math.max(-1, Math.min(1, ux * dx + uy * dy)));
      if (ang < bestAngle) {
        bestAngle = ang;
        bestDir = { dx: ux, dy: uy };
      }
    };
    for (const d of this.world.ducks) {
      if (d.id !== duck.id && d.colour === duck.colour && !d.popping) consider(d.x, d.y);
    }
    for (const b of this.world.barrels) consider(b.x, b.y);
    if (!bestDir) return { dx, dy };
    const t = this.assist;
    const bd = bestDir as { dx: number; dy: number };
    const mx = dx * (1 - t) + bd.dx * t;
    const my = dy * (1 - t) + bd.dy * t;
    const len = Math.hypot(mx, my) || 1;
    return { dx: mx / len, dy: my / len };
  }
}
```

- [ ] **Step 5.3: Run tests — green — commit**

Run: `npx vitest run tests/sim` — Expected: PASS.
Run: `npx tsc --noEmit` — Expected: clean.

```bash
git add -A
git commit -m "feat(sim): pull-back slingshot with cone-based aim assist"
```

---

### Task 6: Director — waves, counter, respawns, finale

**Files:**
- Create: `src/sim/director.ts`
- Test: `tests/sim/director.test.ts`

- [ ] **Step 6.1: Write the failing director tests**

Create `tests/sim/director.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SIM } from '../../src/sim/config';
import { Director } from '../../src/sim/director';

const run = (d: Director, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds * 60); i++) d.step(SIM.DT);
};

describe('Director', () => {
  it('starts wave 1 with the locked layout: 4 ducks, 6 barrels, counter 0/13', () => {
    const d = new Director(7);
    d.start();
    expect(d.world.ducks).toHaveLength(4);
    expect(d.world.barrels).toHaveLength(6);
    expect(d.counter).toEqual({ done: 0, total: 13 });
    expect(d.slingshot.assist).toBeCloseTo(0.35);
  });

  it('advances to wave 2 when all wave-1 barrels die, and raises assist', () => {
    const d = new Director(7);
    d.start();
    for (const b of [...d.world.barrels]) d.world.damageBarrel(b, 99);
    run(d, 1);
    expect(d.wave).toBe(2);
    expect(d.world.barrels).toHaveLength(6);
    expect(d.counter.done).toBe(6);
    expect(d.slingshot.assist).toBeCloseTo(0.55);
  });

  it('respawns popped ducks back up to the wave target', () => {
    const d = new Director(7);
    d.start();
    const duck = d.world.ducks[0]!;
    d.world.blast(duck.colour, duck.x, duck.y); // pops at least that duck
    run(d, 2);
    expect(d.world.ducks.length).toBe(4);
  });

  it('wave 3: golden barrel at 1hp stops respawns and arms the finale', () => {
    const d = new Director(7);
    d.start();
    // clear waves 1 and 2
    for (const b of [...d.world.barrels]) d.world.damageBarrel(b, 99);
    run(d, 1);
    for (const b of [...d.world.barrels]) d.world.damageBarrel(b, 99);
    run(d, 1);
    expect(d.wave).toBe(3);
    const golden = d.world.barrels[0]!;
    expect(golden.golden).toBe(true);
    expect(golden.hp).toBe(3);
    // bring golden to 1hp
    d.world.damageBarrel(golden, 2);
    // pop ducks down to one
    while (d.world.ducks.length > 1) {
      const duck = d.world.ducks[0]!;
      d.world.blast(duck.colour, duck.x, duck.y);
      run(d, 0.5);
    }
    run(d, 3);
    expect(d.world.ducks.length).toBe(1); // no respawn while finale armed
    expect(d.world.events.concat(d.drained).some((e) => e.type === 'finaleArmed')).toBe(true);
    expect(d.slingshot.assist).toBeCloseTo(0.95);
  });

  it('destroying the golden barrel wins', () => {
    const d = new Director(7);
    d.start();
    for (const b of [...d.world.barrels]) d.world.damageBarrel(b, 99);
    run(d, 1);
    for (const b of [...d.world.barrels]) d.world.damageBarrel(b, 99);
    run(d, 1);
    d.world.damageBarrel(d.world.barrels[0]!, 99);
    run(d, 0.5);
    expect(d.won).toBe(true);
    expect(d.counter.done).toBe(13);
  });

  it('never softlocks: if every duck dies pre-finale, one respawns', () => {
    const d = new Director(7);
    d.start();
    while (d.world.ducks.length > 0) {
      const duck = d.world.ducks[0]!;
      d.world.blast(duck.colour, duck.x, duck.y);
      run(d, 0.2);
    }
    run(d, 2);
    expect(d.world.ducks.length).toBeGreaterThan(0);
  });
});
```

Run: `npx vitest run tests/sim/director.test.ts` — Expected: FAIL.

- [ ] **Step 6.2: Implement director.ts**

Create `src/sim/director.ts`:

```ts
import { Slingshot } from './aim';
import { LEVEL, SIM } from './config';
import type { Colour, SimEvent } from './types';
import { World } from './world';

/**
 * Level orchestration: waves, barrel counter, duck respawns, aim-assist ramp,
 * and the rigged finale (golden barrel at 1hp -> respawns stop -> the last
 * duck delivers the winning blow with near-max assist).
 */
export class Director {
  readonly world: World;
  readonly slingshot: Slingshot;
  /** events already drained from world.events by step() — kept for the view */
  drained: SimEvent[] = [];
  wave = 0;
  won = false;
  finaleArmed = false;
  private destroyed = 0;
  private respawnAt: number | null = null;

  constructor(seed: number) {
    this.world = new World(seed);
    this.slingshot = new Slingshot(this.world);
  }

  get counter(): { done: number; total: number } {
    return { done: this.destroyed, total: LEVEL.TOTAL_BARRELS };
  }

  start(): void {
    for (const d of LEVEL.DUCKS) {
      this.world.spawnDuck(d.colour as Colour, d.x, d.y);
    }
    this.startWave(1);
    this.pushCounter();
  }

  private startWave(n: number): void {
    this.wave = n;
    const w = LEVEL.WAVES[n - 1];
    if (!w) return;
    for (const b of w.barrels) {
      this.world.spawnBarrel(
        b.skin as 'wood' | 'yellow' | 'purple' | 'red',
        b.x, b.y, b.hp, (b as { golden?: boolean }).golden ?? false,
      );
    }
    this.slingshot.assist = w.assist;
    this.world.events.push({ type: 'waveStarted', wave: n });
  }

  step(dt: number): void {
    this.world.step(dt);

    // drain world events, reacting to the ones the director cares about
    const evs = this.world.events.splice(0, this.world.events.length);
    for (const e of evs) {
      if (e.type === 'barrelDestroyed') {
        this.destroyed++;
        this.pushLocal({ type: 'counter', done: this.destroyed, total: LEVEL.TOTAL_BARRELS });
      }
    }
    this.drained.push(...evs);

    if (!this.won && this.destroyed >= LEVEL.TOTAL_BARRELS) {
      this.won = true;
      this.pushLocal({ type: 'won' });
    }

    // wave advance
    const waveDef = LEVEL.WAVES[this.wave - 1];
    if (!this.won && waveDef && this.world.barrels.length === 0 && this.wave < LEVEL.WAVES.length) {
      this.startWave(this.wave + 1);
    }

    // finale arming: golden at 1hp
    const golden = this.world.barrels.find((b) => b.golden);
    if (!this.finaleArmed && golden && golden.hp === 1) {
      this.finaleArmed = true;
      this.slingshot.assist = LEVEL.ASSIST_FINALE;
      this.pushLocal({ type: 'finaleArmed' });
    }

    this.handleRespawns(dt);
  }

  private handleRespawns(_dt: number): void {
    if (this.won) return;
    const waveDef = LEVEL.WAVES[this.wave - 1];
    if (!waveDef) return;
    let target = waveDef.targetDucks as number;
    if (this.finaleArmed) target = 1; // the "final duck" moment
    if (this.world.ducks.length === 0) target = Math.max(target, 1); // never softlock

    if (this.world.ducks.length >= target) {
      this.respawnAt = null;
      return;
    }
    if (this.respawnAt === null) {
      this.respawnAt = this.world.time + SIM.RESPAWN_DELAY;
      return;
    }
    if (this.world.time < this.respawnAt) return;
    this.respawnAt = null;

    const colours: Colour[] = ['yellow', 'green', 'purple', 'red'];
    const colour = colours[Math.floor(this.world.rng() * colours.length)]!;
    const spot = this.freeSpot();
    this.world.spawnDuck(colour, spot.x, spot.y);
  }

  private freeSpot(): { x: number; y: number } {
    const R = LEVEL.DUCK_SPAWN_REGION;
    for (let tries = 0; tries < 40; tries++) {
      const x = R.x0 + this.world.rng() * (R.x1 - R.x0);
      const y = R.y0 + this.world.rng() * (R.y1 - R.y0);
      const clear =
        this.world.ducks.every((d) => Math.hypot(d.x - x, d.y - y) > SIM.DUCK_R * 2.4) &&
        this.world.barrels.every((b) => Math.hypot(b.x - x, b.y - y) > SIM.DUCK_R + SIM.BARREL_R + 8);
      if (clear) return { x, y };
    }
    return { x: (R.x0 + R.x1) / 2, y: (R.y0 + R.y1) / 2 };
  }

  private pushCounter(): void {
    this.pushLocal({ type: 'counter', done: this.destroyed, total: LEVEL.TOTAL_BARRELS });
  }

  private pushLocal(e: SimEvent): void {
    this.drained.push(e);
  }
}
```

- [ ] **Step 6.3: Run tests — green — commit**

Run: `npx vitest run tests/sim` — Expected: PASS (all files).
Run: `npx tsc --noEmit` — Expected: clean.

```bash
git add -A
git commit -m "feat(sim): director — waves, counter, respawns, finale rigging, win"
```

---

### Task 7: Bot playthrough harness — prove the level works

**Files:**
- Test: `tests/sim/playthrough.test.ts`

- [ ] **Step 7.1: Write the playthrough harness (this IS the test)**

Create `tests/sim/playthrough.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SIM } from '../../src/sim/config';
import { Director } from '../../src/sim/director';
import { mulberry32 } from '../../src/sim/rng';

/**
 * A mediocre-on-purpose bot: every ~2s it grabs a random resting duck and
 * slings it toward the nearest barrel (or a same-colour duck 30% of the time)
 * with +/-10 degrees of aim noise. Aim assist is expected to carry it — the
 * playable must be winnable by a distracted human thumb.
 */
interface RunStats {
  won: boolean;
  seconds: number;
  finaleArmed: boolean;
  blasts: number;
}

function playOnce(seed: number): RunStats {
  const rng = mulberry32(seed * 7919 + 1);
  const dir = new Director(seed);
  dir.start();
  let nextShotAt = 1.2;
  let blasts = 0;
  let finaleArmed = false;
  const MAX_SECONDS = 120;

  while (!dir.won && dir.world.time < MAX_SECONDS) {
    dir.step(SIM.DT);
    for (const e of dir.drained.splice(0, dir.drained.length)) {
      if (e.type === 'blast') blasts++;
      if (e.type === 'finaleArmed') finaleArmed = true;
    }
    if (dir.world.time < nextShotAt) continue;
    nextShotAt = dir.world.time + 1.6 + rng() * 0.9;

    const resting = dir.world.ducks.filter((d) => !d.live && !d.popping);
    if (resting.length === 0) continue;
    const duck = resting[Math.floor(rng() * resting.length)]!;

    // pick a target: nearest barrel, or 30% a same-colour duck when one exists
    let tx: number, ty: number;
    const mates = dir.world.ducks.filter((d) => d.id !== duck.id && d.colour === duck.colour);
    if (mates.length > 0 && rng() < 0.3) {
      const m = mates[Math.floor(rng() * mates.length)]!;
      tx = m.x; ty = m.y;
    } else if (dir.world.barrels.length > 0) {
      const b = [...dir.world.barrels].sort(
        (p, q) => Math.hypot(p.x - duck.x, p.y - duck.y) - Math.hypot(q.x - duck.x, q.y - duck.y),
      )[0]!;
      tx = b.x; ty = b.y;
    } else {
      continue;
    }

    let ang = Math.atan2(ty - duck.y, tx - duck.x);
    ang += ((rng() - 0.5) * 20 * Math.PI) / 180; // +/-10 deg noise
    const pull = 140 + rng() * 60;
    const sx = duck.x - Math.cos(ang) * pull;
    const sy = duck.y - Math.sin(ang) * pull;
    if (dir.slingshot.begin(duck.x, duck.y)) {
      dir.slingshot.move(sx, sy);
      dir.slingshot.end();
    }
  }
  return { won: dir.won, seconds: dir.world.time, finaleArmed, blasts };
}

describe('level playthrough statistics', () => {
  it('600 bot runs: everyone wins, pacing lands near 40s, finale fires', async () => {
    const runs: RunStats[] = [];
    for (let seed = 1; seed <= 600; seed++) {
      runs.push(playOnce(seed));
      // ~2min of synchronous CPU starves the worker's event loop and the reporter
      // RPC ("onTaskUpdate") times out. Yielding periodically keeps it alive.
      if (seed % 25 === 0) await new Promise((r) => setImmediate(r));
    }

    const winRate = runs.filter((r) => r.won).length / runs.length;
    const times = runs.map((r) => r.seconds).sort((a, b) => a - b);
    const p50 = times[Math.floor(times.length / 2)]!;
    const p90 = times[Math.floor(times.length * 0.9)]!;
    const finaleRate = runs.filter((r) => r.finaleArmed).length / runs.length;
    const avgBlasts = runs.reduce((s, r) => s + r.blasts, 0) / runs.length;

    // eslint-disable-next-line no-console
    console.log({ winRate, p50: p50.toFixed(1), p90: p90.toFixed(1), finaleRate, avgBlasts: avgBlasts.toFixed(1) });

    expect(winRate).toBe(1);
    expect(p50).toBeGreaterThan(25);
    expect(p50).toBeLessThan(55);
    expect(p90).toBeLessThan(80);
    expect(finaleRate).toBeGreaterThan(0.85);
    expect(avgBlasts).toBeGreaterThan(4);
    // 600 runs is ~2min of CPU here. The old 120s budget never fired while the loop
    // blocked the event loop; now that it yields, the timer works — so give it real
    // headroom. This bounds a hang, it does not assert performance.
  }, 600_000);
});
```

- [ ] **Step 7.2: Run it and tune constants until green**

Run: `npx vitest run tests/sim/playthrough.test.ts`

This is the balancing step. Expected first-run outcome: it may fail on pacing. Tune in this order, one at a time, re-running after each change (all in `src/sim/config.ts`):
1. `p50` too long → raise wave `assist` values (+0.1) or raise `LAUNCH_K` to 7.5; too short → lower assist by 0.05–0.1 or raise barrel HP is NOT allowed (locked 2–3) — instead slow the bot cadence is NOT allowed (bot is fixed) — lower `BLAST_R` to 120.
2. `finaleRate` low → check golden HP path: assist during wave 3 should be ≥0.85.
3. `winRate` < 1 → inspect a failing seed: `playOnce(seed)` with logs; usually the bot ran out of time (raise assist) — the safety respawn already prevents true softlocks.

The console.log line stays in — its numbers go into the final writeup.

**Tuning outcome (recorded 2026-08-02):** first run was `winRate 1.0, p50 67.6, p90 83.1, finaleRate 1.0, avgBlasts 0.0`.

- **Rule 1 above measured backwards.** Raising wave assist made runs *slower* (+0.1 assist → p50 70.2; +0.2 → 69.3), because a high-assist shot drives straight into one barrel and stops, while a sloppier shot ricochets into extra barrels. `LAUNCH_K 7.5` was inert (launch speed is already 7–10× `BARREL_HIT_SPEED`). The pacing lever that actually worked was `FRICTION`.
- **`avgBlasts` was structurally 0, not a balance miss.** With four *distinct* duck colours, no same-colour pair can exist; ducks are only removed by popping, and `handleRespawns` only fires below `targetDucks` (4) — so the pop → blast → chain path was unreachable in real play and only unit tests exercised it. Fixed by making the fourth duck green (user-approved, see Locked design inputs).
- **Damage arithmetic:** 13 barrels × 2–3 hp = 27 damage points. At ~1 damage per direct hit and the bot's 2.05 s average cadence, a *perfect* run floors at ~54.5 s — so `p50 < 55` is unreachable without blasts contributing multi-barrel damage.
- **Final config:** `FRICTION 1.4 → 0.6`, `BARREL_HIT_SPEED 150 → 90`, fourth duck purple → green. Result at 600 seeds: `winRate 1, p50 51.5, p90 67.6, finaleRate 0.99, avgBlasts 9.9` (93 s runtime). The Task 3 barrel-impact test window shrank 90 → 30 steps because the lower damping lets the duck rebound off the wall for a second hit inside 1.5 s.
- **Post-Phase-B change (2026-08-03, user-requested): fixed launch speed.** To match the official Duckies Pop example (`vel = normalize(direction) * FIXED_SPEED`), the drag now sets *direction only* — `MAX_PULL` and `LAUNCH_K` are gone, replaced by `SIM.LAUNCH_SPEED = 1200` px/s. 1200 was chosen because the old variable speeds already averaged ~1200 (the bot's 140–200 px pulls × `LAUNCH_K` 7.0), so balance was expected to carry over — and it did, with no tuning iterations needed: `winRate 1, p50 52.4, p90 69.3, finaleRate 0.985, avgBlasts 9.9` (vs. 51.5 / 67.6 / 0.99 / 9.9 before). The aim line became a fixed-length (260 px) direction indicator, since a length-proportional one would now imply power the shot does not have.
- **Reporter deadlock (fixed in Task 9).** The 600-seed loop ran as one unbroken block of synchronous CPU, so the vitest worker never serviced its event loop and the reporter's `onTaskUpdate` RPC timed out — the suite printed 32/32 green but `npm test` still exited 1. Fixed by making the test `async` and awaiting a `setImmediate` every 25 seeds. That yield also lets the per-test timeout timer actually fire for the first time, which exposed that the real runtime (~121–127 s here, vs. the 93 s measured during tuning) exceeds the original `120_000` budget, so it was raised to `600_000`. No assertion, bot, or sim constant changed.

- [ ] **Step 7.3: Commit**

```bash
git add -A
git commit -m "test(sim): 600-run bot playthrough harness proving win rate and pacing"
```

---

### Task 8: View layer — the game on screen

**Files:**
- Create: `src/game/scene.ts`
- Modify: `src/main.ts`

No unit tests for the view (it is Pixi-bound); verification is the existing screenshot harness + manual play. Keep ALL existing environment visuals untouched.

- [ ] **Step 8.1: Create scene.ts**

Create `src/game/scene.ts`:

```ts
import { Application, Container, Graphics } from 'pixi.js';
import type { Spine } from '@esotericsoftware/spine-pixi-v8';
import { Director } from '../sim/director';
import { SIM } from '../sim/config';
import type { Barrel, Colour, Duck, SimEvent } from '../sim/types';
import { loadSkeleton, makeSpine, type SkeletonBundle } from '../engine/spineLoader';

import duckySkelUrl from '../assets/entities/ducky/ducky.skel';
import duckyAtlasText from '../assets/entities/ducky/ducky.atlas?raw';
import duckyPageUrl from '../assets/entities/ducky/ducky.webp';
import crateSkelUrl from '../assets/entities/crate-round/crate-round.skel';
import crateAtlasText from '../assets/entities/crate-round/crate-round.atlas?raw';
import cratePageUrl from '../assets/entities/crate-round/crate-round.webp';
import handJsonUrl from '../assets/entities/tutorial-hand/tutorial-hand.json?url';
import handAtlasText from '../assets/entities/tutorial-hand/tutorial-hand.atlas?raw';
import handPageUrl from '../assets/entities/tutorial-hand/tutorial-hand.webp';

const DUCK_SCALE = 0.9;
const BARREL_SCALE = 0.85;

/** remaining hp -> crate-round set-pose animation (clasps strip as hp falls) */
function stageFor(b: { maxHp: number; hp: number }): string {
  if (b.maxHp >= 3) return b.hp >= 3 ? 'hp5' : b.hp === 2 ? 'hp3' : 'hp1';
  return b.hp >= 2 ? 'hp3' : 'hp1';
}

export class GameScene {
  readonly director: Director;
  private duckViews = new Map<number, Spine>();
  private barrelViews = new Map<number, Spine>();
  private layer = new Container();
  private fx = new Container();
  private aimLine = new Graphics();
  private hand: Spine | null = null;
  private duckyData!: SkeletonBundle;
  private crateData!: SkeletonBundle;
  private accumulator = 0;

  constructor(private app: Application, seed: number) {
    this.director = new Director(seed);
  }

  async init(): Promise<void> {
    this.duckyData = await loadSkeleton({
      skelUrl: duckySkelUrl, atlasText: duckyAtlasText, pageUrl: duckyPageUrl,
    });
    this.crateData = await loadSkeleton({
      skelUrl: crateSkelUrl, atlasText: crateAtlasText, pageUrl: cratePageUrl,
    });
    this.app.stage.addChild(this.layer, this.fx, this.aimLine);

    this.wireInput();
    this.director.start();
    this.drainEvents(); // creates initial views

    // tutorial hand taps beside the red duck until first successful drag
    const handData = await loadSkeleton({
      jsonUrl: handJsonUrl, atlasText: handAtlasText, pageUrl: handPageUrl,
    });
    this.hand = makeSpine(handData);
    this.hand.state.setAnimation(0, 'tap', true);
    this.hand.position.set(495, 365);
    this.hand.scale.set(0.25);
    this.fx.addChild(this.hand);

    this.app.ticker.add((t) => this.tick(t.deltaMS / 1000));
  }

  private wireInput(): void {
    const stage = this.app.stage;
    stage.eventMode = 'static';
    stage.hitArea = { contains: () => true };
    stage.on('pointerdown', (e) => {
      const p = e.getLocalPosition(stage);
      if (this.director.slingshot.begin(p.x, p.y) && this.hand) {
        this.hand.visible = false; // tutorial done
      }
    });
    stage.on('pointermove', (e) => {
      const p = e.getLocalPosition(stage);
      this.director.slingshot.move(p.x, p.y);
    });
    const up = (): void => {
      this.director.slingshot.end();
      this.aimLine.clear();
    };
    stage.on('pointerup', up);
    stage.on('pointerupoutside', up);
  }

  private tick(dt: number): void {
    // fixed-step the sim regardless of render rate
    this.accumulator += Math.min(dt, 0.1);
    while (this.accumulator >= SIM.DT) {
      this.director.step(SIM.DT);
      this.accumulator -= SIM.DT;
    }
    this.drainEvents();
    this.syncViews(dt);
    this.drawAim();
  }

  private drainEvents(): void {
    for (const e of this.director.drained.splice(0, this.director.drained.length)) {
      this.onEvent(e);
    }
  }

  private onEvent(e: SimEvent): void {
    switch (e.type) {
      case 'duckSpawned':
        this.addDuck(e.duck);
        break;
      case 'duckPopped': {
        const v = this.duckViews.get(e.id);
        if (v) {
          v.destroy();
          this.duckViews.delete(e.id);
        }
        break;
      }
      case 'blast':
        this.flashBlast(e.x, e.y, e.r, e.colour);
        break;
      case 'barrelSpawned':
        this.addBarrel(e.barrel);
        break;
      case 'barrelDamaged': {
        const v = this.barrelViews.get(e.id);
        if (v) {
          const b = this.director.world.barrels.find((k) => k.id === e.id);
          if (b) v.state.setAnimation(0, stageFor(b), false);
          v.state.setAnimation(1, 'hit', false);
          v.state.addEmptyAnimation(1, 0.1, 0);
        }
        break;
      }
      case 'barrelDestroyed': {
        const v = this.barrelViews.get(e.id);
        if (v) {
          this.barrelViews.delete(e.id);
          v.state.setAnimation(0, 'hp0', false);
          let t = 0;
          const fade = (tk: { deltaMS: number }): void => {
            t += tk.deltaMS / 1000;
            v.alpha = Math.max(0, 1 - t / 0.45);
            if (t >= 0.45) {
              this.app.ticker.remove(fade);
              v.destroy();
            }
          };
          this.app.ticker.add(fade);
        }
        break;
      }
      default:
        break; // counter/waveStarted/finaleArmed/won get UI in Phase C
    }
  }

  private addDuck(d: Duck): void {
    const s = makeSpine(this.duckyData);
    s.skeleton.setSkinByName(d.colour);
    s.skeleton.setSlotsToSetupPose();
    s.state.setAnimation(0, 'idle', true);
    s.state.timeScale = 0.8 + (d.id % 5) * 0.1;
    s.scale.set(DUCK_SCALE);
    s.position.set(d.x, d.y);
    this.layer.addChild(s);
    this.duckViews.set(d.id, s);
  }

  private addBarrel(b: Barrel): void {
    const s = makeSpine(this.crateData);
    s.skeleton.setSkinByName(b.skin);
    s.skeleton.setSlotsToSetupPose();
    s.state.setAnimation(0, stageFor(b), false);
    s.scale.set(BARREL_SCALE);
    s.position.set(b.x, b.y);
    this.layer.addChild(s);
    this.barrelViews.set(b.id, s);
  }

  private flashBlast(x: number, y: number, r: number, colour: Colour): void {
    // placeholder ring — Phase C replaces with vfx sprites
    const tints: Record<Colour, number> = {
      yellow: 0xffd94d, green: 0x5cc80e, purple: 0xa44aed, red: 0xec273f,
    };
    const g = new Graphics().circle(x, y, r).stroke({ width: 10, color: tints[colour], alpha: 0.9 });
    this.fx.addChild(g);
    let t = 0;
    const anim = (tk: { deltaMS: number }): void => {
      t += tk.deltaMS / 1000;
      g.alpha = Math.max(0, 1 - t / 0.25);
      g.scale.set(1 + t * 1.2);
      g.pivot.set(x * (g.scale.x - 1) / g.scale.x, y * (g.scale.y - 1) / g.scale.y);
      if (t >= 0.25) {
        this.app.ticker.remove(anim);
        g.destroy();
      }
    };
    this.app.ticker.add(anim);
  }

  private syncViews(dt: number): void {
    for (const d of this.director.world.ducks) {
      const v = this.duckViews.get(d.id);
      if (v) {
        v.position.set(d.x, d.y);
        v.update(dt);
      }
    }
    for (const [, v] of this.barrelViews) v.update(dt);
    if (this.hand?.visible) this.hand.update(dt);
  }

  private drawAim(): void {
    this.aimLine.clear();
    const p = this.director.slingshot.pull;
    if (!p || p.len < 10) return;
    // simple dotted line opposite the pull (placeholder for Phase C aim vfx)
    const len = Math.min(p.len, SIM.MAX_PULL);
    const ux = p.dx / (p.len || 1), uy = p.dy / (p.len || 1);
    for (let i = 1; i <= 8; i++) {
      const f = (i / 8) * len * 2.2;
      this.aimLine.circle(p.duck.x + ux * f, p.duck.y + uy * f, 7 - i * 0.5).fill({ color: 0xffffff, alpha: 0.85 });
    }
  }
}
```

Note: `SkeletonBundle` must match the actual exported type name of `loadSkeleton`'s return in `src/engine/spineLoader.ts` — check the file and use the real name (it may be an inline return type; if so, export a named type there as a tiny refactor).

- [ ] **Step 8.2: Rework main.ts**

In `src/main.ts`:
1. DELETE the entity showcase blocks: the ducks array/forEach, the wood-barrel row + wobbler, the colour-barrel row, and the tutorial-hand block, plus the `spines` array/`add` helper and the central ticker loop (scene.ts owns ticking now). KEEP: app init, fitCanvas, bg tile, water + mask, ring shadow/white, bumper sprites, tub frame — everything environmental, in the existing order.
2. DELETE the now-unused imports (ducky/crate/hand assets) — scene.ts imports them itself.
3. After the environment is built, add:

```ts
  const { GameScene } = await import('./game/scene');
  const scene = new GameScene(app, 20260802);
  await scene.init();
```

(Static import at top of file is also fine — the dynamic import just keeps the diff local.)

4. Keep `(window as unknown as { __sceneReady?: boolean }).__sceneReady = true;` as the LAST line of boot().

- [ ] **Step 8.3: Build, screenshot, play**

Run: `npm run build` — Expected: clean type-check and build.
Run: `node tests/shot.mjs dist/duckies-pop-playable.html` — Expected: exit 0, screenshot shows ducks + wave-1 barrels inside the tub.

Manual check (dev server): `npx vite --port 5199` → open `http://localhost:5199`:
- drag a duck: dotted aim line appears opposite the pull, release fires
- hitting a same-colour duck pops both with a colour ring flash; chains work
- barrels lose clasps per hit and vanish at 0 hp; wave 2 spawns after 6 kills; golden barrel appears in wave 3; game ends (no end card yet — Phase C)

- [ ] **Step 8.4: Commit**

```bash
git add -A
git commit -m "feat(game): live scene — sim-bound spines, drag input, blast fx, waves"
```

---

### Task 9: Full verification + tag

- [ ] **Step 9.1: Full test suite + build + screenshot gate**

Run: `npm test` — Expected: ALL sim tests + playthrough green.
Run: `npm run build` — Expected: single file under 5 MB (should stay ≈0.9 MB).
Run: `node tests/shot.mjs dist/duckies-pop-playable.html --all` — Expected: exit 0 at all three viewports.

- [ ] **Step 9.2: Tag and record**

```bash
git tag phase-b-playable
git commit --allow-empty -m "chore: phase B complete — playable sim with rigged finale"
```

Report the playthrough stats line (winRate / p50 / p90 / finaleRate / avgBlasts) back to the controller for the final writeup.

---

## Self-Review Notes

- **Spec coverage:** slingshot ✓ (Task 5), same-colour pops ✓ (T4), colour blasts + chains ✓ (T4), barrels damaged by hits AND blasts ✓ (T3/T4), 2–3 HP with clasp stages ✓ (config + stageFor), bumpers ✓ (T2), waves + counter ✓ (T6), whiff forgiveness ✓ (T5 MIN_PULL), escalating assist ✓ (T6), final-duck ending ✓ (T6 finale + T7 finaleRate assert), ~40 s pacing ✓ (T7 p50 bounds), no fireworks ✓ (absent), win-only ✓ (no lose path; safety respawn).
- **Type consistency:** `Duck`/`Barrel`/`SimEvent` defined once in types.ts and imported everywhere; `Slingshot.assist` is the single assist knob, set only by Director; `damageBarrel`/`blast` are World methods used by Director and tests alike.
- **Known intentional simplifications:** barrels are static circles (no knockback); blast damage has no per-shot dedup (a direct hit + blast can double-hit — acceptable, feels generous); duck idle drift is visual-only (Spine bob), not simulated.
- **Risk & mitigation:** Task 7 is the only step expected to need iteration (tuning). Its knobs and order are listed. If `spineLoader` lacks a named return type, Task 8 includes the tiny refactor to export one.
