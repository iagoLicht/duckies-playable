import { SIM } from './config';
import { mulberry32, type Rng } from './rng';
import { collideCircle } from './shapes';
import type { Barrel, Clam, Colour, Duck, SimEvent } from './types';

/**
 * Pure simulation world. Deterministic: all randomness via the seeded rng,
 * fixed-timestep stepping only. Emits SimEvents into `events`; the caller
 * (view or test) drains the array each frame.
 */
export class World {
  readonly rng: Rng;
  readonly ducks: Duck[] = [];
  readonly barrels: Barrel[] = [];
  readonly clams: Clam[] = [];
  readonly events: SimEvent[] = [];
  time = 0;
  /** 0 while a fresh shot flies untouched (light drag); 1 after its first contact */
  phase = 1;
  private nextId = 1;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
  }

  spawnDuck(colour: Colour, x: number, y: number): Duck {
    const d: Duck = {
      id: this.nextId++, kind: 'duck', colour, x, y, vx: 0, vy: 0,
      live: false, popping: false, matched: false, matchFuse: 0,
      popOnSettle: false, settleTicks: 0, ticksMoving: 0,
    };
    this.ducks.push(d);
    this.events.push({ type: 'duckSpawned', duck: d });
    return d;
  }

  spawnBarrel(skin: Barrel['skin'], x: number, y: number, hp: number, golden = false): Barrel {
    // hard cap: 2 clasp layers is the deepest stage a barrel can ever show
    const capped = Math.max(1, Math.min(3, hp));
    const b: Barrel = {
      id: this.nextId++, kind: 'barrel', skin, x, y,
      hp: capped, maxHp: capped, golden, hitCooldown: 0,
    };
    this.barrels.push(b);
    this.events.push({ type: 'barrelSpawned', barrel: b });
    return b;
  }

  spawnClam(x: number, y: number, skin: Clam['skin'] = 'normal'): Clam {
    const c: Clam = { id: this.nextId++, kind: 'clam', x, y, skin, open: false };
    this.clams.push(c);
    this.events.push({ type: 'clamSpawned', clam: c });
    return c;
  }

  /**
   * Crack a clam open and spill its pearl. Idempotent: a clam opens once, then
   * stays a plain bumper for the rest of the level.
   */
  openClam(c: Clam): void {
    if (c.open) return;
    c.open = true;
    this.events.push({ type: 'clamOpened', id: c.id, x: c.x, y: c.y });
    this.events.push({ type: 'pearlReleased', id: c.id, x: c.x, y: c.y });
  }

  launch(id: number, vx: number, vy: number): void {
    const d = this.ducks.find((k) => k.id === id);
    if (!d) return;
    d.vx = vx;
    d.vy = vy;
    d.live = true;
    d.ticksMoving = 0;
    this.phase = 0; // the new shot flies clean until it touches something
    this.events.push({ type: 'duckLaunched', id });
  }

  step(dt: number): void {
    this.time += dt;

    // contact-damage cooldowns tick down once per fixed step
    for (const b of this.barrels) {
      if (b.hitCooldown > 0) b.hitCooldown--;
    }

    // official drag (decomp xr): banded, v *= 1/(1+drag·dt), with a hard stop
    const stop2 = SIM.STOP_SPEED * SIM.STOP_SPEED;
    const slow2 = SIM.SLOW_SPEED * SIM.SLOW_SPEED;
    let max2 = 0;
    for (const d of this.ducks) {
      const sp2 = d.vx * d.vx + d.vy * d.vy;
      if (sp2 === 0) continue;
      if (sp2 < stop2) {
        d.vx = 0;
        d.vy = 0;
        d.ticksMoving = 0;
        if (d.live) {
          d.live = false;
          this.events.push({ type: 'duckStopped', id: d.id });
        }
        continue;
      }
      let drag: number;
      if (sp2 < slow2) drag = SIM.DRAG_SETTLE;
      else if (this.phase > 0) drag = SIM.DRAG_CONTACT;
      else {
        const t = Math.min(1, d.ticksMoving / SIM.DRAG_RAMP_TICKS);
        drag = SIM.DRAG_FLIGHT + t * t * t * t * (SIM.DRAG_SETTLE - SIM.DRAG_FLIGHT);
      }
      const k = 1 / (1 + drag * dt);
      d.vx *= k;
      d.vy *= k;
      d.ticksMoving++;
      if (sp2 > max2) max2 = sp2;
    }

    // adaptive substeps (official): keep per-substep travel near SUBSTEP_DIST
    const steps = Math.min(16, Math.max(2, Math.ceil((Math.sqrt(max2) * dt) / SIM.SUBSTEP_DIST)));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (const d of this.ducks) {
        d.x += d.vx * h;
        d.y += d.vy * h;
      }
      this.collideWalls();
      this.collideDuckPairs();
      this.collideDuckBarrels();
      this.collideDuckClams();
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
      d.matchFuse--; // drives the blink band; may run past 0 (see below)
      if (d.popOnSettle) {
        // A blast victim explodes ONLY when it is fully idle — dead still (the
        // step snaps sub-STOP_SPEED motion to exactly zero) for a whole
        // confirmation hold, the counter resetting the instant anything bumps
        // it back into motion. Nothing else can pop it: its fuse keeps counting
        // for the blink but never fires the shot out from under a moving duck,
        // and drag guarantees it does come to rest.
        d.settleTicks = d.vx === 0 && d.vy === 0 ? d.settleTicks + 1 : 0;
        if (d.settleTicks >= SIM.BLAST_SETTLE_CONFIRM_TICKS) this.popDuck(d);
        continue;
      }
      // contact-matched pairs are unchanged: pure fuse, settled or not, so a
      // pair flagged on the same tick still pops on the same tick
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

  /**
   * Official wall rule (decomp Yr): walls do NOT mirror. The tangential velocity
   * survives untouched and the exit speed along the normal becomes a share of
   * the duck's TOTAL speed, floored — a grazing duck is thrown out into the
   * field, and a wall can never absorb a duck outright. Bumpers fling instead:
   * a big fixed kick plus half the incoming speed. Speed is capped afterwards.
   */
  private collideWalls(): void {
    for (const d of this.ducks) {
      const hit = collideCircle(d.x, d.y, SIM.DUCK_R);
      if (!hit) continue;
      d.x = hit.x;
      d.y = hit.y;
      const speed = Math.hypot(d.vx, d.vy);
      const vn = d.vx * hit.nx + d.vy * hit.ny;
      const tx = d.vx - vn * hit.nx;
      const ty = d.vy - vn * hit.ny;
      const kick = hit.source === 'bumper'
        ? SIM.BUMPER_KICK + SIM.BUMPER_KEEP * speed
        : Math.max(SIM.WALL_MIN_KICK, SIM.WALL_KICK * speed);
      d.vx = tx + hit.nx * kick;
      d.vy = ty + hit.ny * kick;
      const out = Math.hypot(d.vx, d.vy);
      if (out > SIM.MAX_SPEED) {
        const f = SIM.MAX_SPEED / out;
        d.vx *= f;
        d.vy *= f;
      }
      if (this.phase === 0) this.phase = 1;
      this.events.push({
        type: 'wallHit', id: d.id, source: hit.source,
        x: d.x - hit.nx * SIM.DUCK_R * 0.8, y: d.y - hit.ny * SIM.DUCK_R * 0.8,
        nx: hit.nx, ny: hit.ny, speed,
      });
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
        if (this.phase === 0) this.phase = 1; // any touch ends the shot's clean flight
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
        if (this.phase === 0) this.phase = 1;
        const vn = d.vx * nx + d.vy * ny;
        if (vn < 0) {
          // official bounceOffStatic: plain normal reflection at half energy
          d.vx -= (1 + SIM.RESTITUTION_STATIC) * vn * nx;
          d.vy -= (1 + SIM.RESTITUTION_STATIC) * vn * ny;
        }
        // ANY duck, any colour, launched or knocked: approaching faster than
        // the threshold chips exactly one stage. vn < 0 restricts this to real
        // approaches (a still-overlapping duck drifting AWAY doesn't re-hit),
        // and the cooldown keeps one physical collision from counting twice
        // across substeps or contact jitter.
        if (vn < -SIM.BARREL_HIT_SPEED && b.hitCooldown === 0) {
          b.hitCooldown = SIM.BARREL_HIT_COOLDOWN_TICKS;
          this.damageBarrel(b, 1);
        }
      }
    }
  }

  /**
   * Clams are solid bumpers whether open or shut (the rig IS the game's bumper),
   * so this always bounces. A hard enough approach — the same speed bar a match
   * needs — additionally cracks a shut one open, mirroring the official's
   * `caseContact`: bounce off static, then hit the case if the approach was fast.
   */
  private collideDuckClams(): void {
    for (const d of this.ducks) {
      for (const c of this.clams) {
        const dx = d.x - c.x, dy = d.y - c.y;
        const dist = Math.hypot(dx, dy);
        const minD = SIM.DUCK_R + SIM.CLAM_R;
        if (dist >= minD || dist === 0) continue;
        const nx = dx / dist, ny = dy / dist;
        d.x = c.x + nx * minD;
        d.y = c.y + ny * minD;
        if (this.phase === 0) this.phase = 1;
        const vn = d.vx * nx + d.vy * ny;
        if (vn < 0) {
          d.vx -= (1 + SIM.RESTITUTION_STATIC) * vn * nx;
          d.vy -= (1 + SIM.RESTITUTION_STATIC) * vn * ny;
          this.events.push({ type: 'bumperHit', id: c.id, x: d.x, y: d.y });
        }
        if (vn < -SIM.CLAM_HIT_SPEED) this.openClam(c);
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
   * Detonation: EVERY duck in the radius, whatever its colour, takes a radial
   * shove (linear centre→edge falloff), starts blinking, and is doomed — it
   * drifts, settles, and only then explodes (see tickFuses), so each chain
   * generation is paced by its victim's own slide. Barrels take a hit
   * regardless of colour.
   *
   * Reach is pure CENTRE distance <= BLAST_R, with no body-radius padding, as
   * the official's `explodeAt` does (decomp: `fr(r.pos, A) > s`, s = radius²).
   */
  blast(colour: Colour, x: number, y: number): void {
    this.events.push({ type: 'blast', colour, x, y, r: SIM.BLAST_R });
    for (const d of this.ducks) {
      if (d.popping) continue;
      const dist = Math.hypot(d.x - x, d.y - y);
      if (dist > SIM.BLAST_R) continue;
      const kick = SIM.BLAST_KNOCK - (SIM.BLAST_KNOCK - SIM.BLAST_KNOCK_EDGE) * (dist / SIM.BLAST_R);
      // dist 0 can't happen for a bystander (bodies separate), but guard anyway
      const nx = dist > 0 ? (d.x - x) / dist : 0;
      const ny = dist > 0 ? (d.y - y) / dist : -1;
      d.vx += nx * kick;
      d.vy += ny * kick;
      d.live = true; // in motion now — the stop logic will settle it normally
      const fresh = !d.matched;
      this.flagMatched(d); // blink starts now (no-op if the fuse is already lit)
      // Only a duck this blast newly caught becomes settle-gated. A duck already
      // burning a contact fuse keeps it, so a same-colour pair — whose first
      // pop necessarily blasts its partner — still goes off together.
      if (fresh) {
        d.popOnSettle = true; // detonates once settled and held still
        d.settleTicks = 0;
      }
    }
    for (const b of [...this.barrels]) {
      if (Math.hypot(b.x - x, b.y - y) <= SIM.BLAST_R) {
        this.damageBarrel(b, 1);
      }
    }
    // the official's explodeAt opens cases caught in the blast too
    for (const c of this.clams) {
      if (Math.hypot(c.x - x, c.y - y) <= SIM.BLAST_R) this.openClam(c);
    }
  }
}
