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

  constructor(seed: number) {
    this.rng = mulberry32(seed);
  }

  spawnDuck(colour: Colour, x: number, y: number): Duck {
    const d: Duck = {
      id: this.nextId++, kind: 'duck', colour, x, y, vx: 0, vy: 0,
      live: false, popping: false, matched: false, matchFuse: 0,
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

    this.tickFuses();
  }

  /**
   * One fixed step == one fuse tick. Runs after the substeps, mirroring the
   * official's tick order: a duck flagged by a contact this tick is already
   * down to MATCH_FUSE_TICKS - 1 by the time the view first sees it.
   */
  private tickFuses(): void {
    // popDuck splices, and its blast can flag ducks further along — snapshot
    for (const d of [...this.ducks]) {
      if (!d.matched || d.popping) continue;
      d.matchFuse--;
      if (d.matchFuse <= 0) this.popDuck(d);
    }
  }

  /**
   * Light the fuse. Guarded per duck, so a blinking duck that ploughs into a
   * fresh same-colour one flags its victim without resetting its own fuse.
   */
  private flagMatched(d: Duck): void {
    if (d.matched || d.popping) return;
    d.matched = true;
    d.matchFuse = SIM.MATCH_FUSE_TICKS;
    this.events.push({ type: 'duckMatched', id: d.id });
  }

  /** Remove the duck now and detonate where it stood. */
  popDuck(d: Duck): void {
    if (d.popping) return;
    d.popping = true;
    const idx = this.ducks.indexOf(d);
    if (idx >= 0) this.ducks.splice(idx, 1);
    this.events.push({ type: 'duckPopped', id: d.id, colour: d.colour, x: d.x, y: d.y });
    this.blast(d.colour, d.x, d.y);
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

  /**
   * Same-colour contact above POP_SPEED lights both fuses (official: the pair's
   * PRE-bounce relative speed decides, and both ducks are flagged even when only
   * one was the shot). Nothing pops here — flagMatched does the guarding.
   */
  protected onDuckContact(a: Duck, b: Duck, relSpeed: number): void {
    if (a.colour !== b.colour) return;
    if (!a.live && !b.live) return;
    if (relSpeed < SIM.POP_SPEED) return;
    this.flagMatched(a);
    this.flagMatched(b);
  }

  private collideDuckBarrels(): void {
    for (const d of this.ducks) {
      // snapshot: damageBarrel splices destroyed barrels out mid-iteration
      for (const b of [...this.barrels]) {
        if (b.hp <= 0) continue; // already destroyed this substep
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

  /**
   * Detonation: same-colour ducks in radius get a FRESH fuse rather than an
   * instant pop, so each chain generation costs one full fuse. Barrels take a
   * hit regardless of colour.
   */
  blast(colour: Colour, x: number, y: number): void {
    this.events.push({ type: 'blast', colour, x, y, r: SIM.BLAST_R });
    for (const d of this.ducks) {
      if (d.colour !== colour || d.popping || d.matched) continue;
      if (Math.hypot(d.x - x, d.y - y) <= SIM.BLAST_R + SIM.DUCK_R) {
        this.flagMatched(d);
      }
    }
    for (const b of [...this.barrels]) {
      if (Math.hypot(b.x - x, b.y - y) <= SIM.BLAST_R + SIM.BARREL_R) {
        this.damageBarrel(b, 1);
      }
    }
  }
}
