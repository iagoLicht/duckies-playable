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
}
