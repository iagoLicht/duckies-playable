import { SIM } from './config';
import { mulberry32, type Rng } from './rng';
import { collideCircle } from './shapes';
import type { Barrel, Clam, Colour, Duck, Pearl, SimEvent } from './types';

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
  /** pearls in the air, each on its own flight clock — see tickClams */
  readonly pearls: Pearl[] = [];
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
      shotStrikePending: false, spawnShieldTicks: SIM.SPAWN_SHIELD_TICKS,
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
      hp: capped, maxHp: capped, golden, hitCooldown: 0, hitBy: 0,
    };
    this.barrels.push(b);
    this.events.push({ type: 'barrelSpawned', barrel: b });
    return b;
  }

  spawnClam(x: number, y: number, skin: Clam['skin'] = 'normal'): Clam {
    const c: Clam = {
      id: this.nextId++, kind: 'clam', x, y, skin,
      open: false, cycleTicks: 0, active: true, hitThisStep: [],
    };
    this.clams.push(c);
    this.events.push({ type: 'clamSpawned', clam: c });
    return c;
  }

  /**
   * Trigger a clam. EVERY hit runs the whole routine — the shell jolts open, a
   * pearl comes out, the lid's shut-eye art reads as the blink — and the only
   * thing that refuses is a SPENT shell, whose quota is met.
   *
   * IT USED TO REFUSE WHILE OPEN, and that gate is the reported bug (measured:
   * over 10 levels x 15 bot seeds, 2523 of 5245 physical duck-on-shell contacts
   * — 48% — produced no routine at all, and every one of them was this gate.
   * Half were a different duck arriving while the first duck's cycle ran.) The
   * cycle is 60 ticks, a full second: for a second after any hit the shell flung
   * ducks away with its bump sound and did nothing else, which is exactly the
   * "sometimes it just doesn't react" the player sees. `open` is the shell's
   * POSE, not a busy flag, so a hit landing mid-cycle simply restarts it.
   *
   * ONE impact frame: the shell's squash, its opening and the pearl all start
   * here, on the same tick the duck is flung away. Nothing is staged behind a
   * delay — the view reads both of these events off the same drain.
   *
   * The pearl gets its own id and its own flight clock (see tickClams), because
   * re-opening mid-cycle means two pearls from one shell can be in the air at
   * once. What guarantees one pearl per HIT is not this method — it is the
   * caller's substep debounce in collideDuckClams.
   */
  hitClam(c: Clam): void {
    if (!c.active) return;
    c.open = true;
    c.cycleTicks = 0;
    const pearl = this.nextId++;
    this.pearls.push({ id: pearl, clam: c.id, ticks: 0 });
    this.events.push({ type: 'clamOpened', id: c.id, x: c.x, y: c.y });
    this.events.push({ type: 'pearlReleased', id: c.id, pearl, x: c.x, y: c.y });
  }

  /** Retire every clam: still solid, still visible, but no longer reactive. */
  spendClams(): void {
    for (const c of this.clams) c.active = false;
    this.events.push({ type: 'clamsSpent' });
  }

  /**
   * Drive each open shell through its cycle, and each pearl through its flight.
   * The spill is NOT here — it happens on the impact tick in hitClam, so the hit
   * reads as one event. What is left runs on tick counts that live in SIM, so
   * the view animates off the same numbers rather than re-deriving them:
   *   CLAM_CYCLE_TICKS    the shell shuts (a fresh hit restarts the count)
   *   PEARL_FLIGHT_TICKS  the pearl reaches the HUD -> the counter drops by 1
   *
   * The two are counted SEPARATELY. The pearl used to ride the shell's
   * `cycleTicks`, which was safe only while a shell could not re-open mid-cycle:
   * now that every hit pays out, a second hit resetting that counter would have
   * stranded the first pearl in the air with its arrival never announced — the
   * view holds each pearl just short of the counter until the sim says it landed.
   *
   * This is also where the per-step contact debounce is cleared, so the window
   * is exactly one fixed step: the substep loop counts a collision once, and the
   * next step's contact is free to run the routine again.
   */
  private tickClams(): void {
    for (const c of this.clams) {
      c.hitThisStep.length = 0;
      if (!c.open) continue;
      c.cycleTicks++;
      if (c.cycleTicks >= SIM.CLAM_CYCLE_TICKS) {
        c.open = false;
        c.cycleTicks = 0;
        this.events.push({ type: 'clamClosed', id: c.id });
      }
    }
    // compacted in place, forwards, so arrivals are announced in the order the
    // pearls were spilled — the counter drops for the oldest one first
    let kept = 0;
    for (const p of this.pearls) {
      if (++p.ticks < SIM.PEARL_FLIGHT_TICKS) {
        this.pearls[kept++] = p;
        continue;
      }
      this.events.push({ type: 'pearlCollected', id: p.clam, pearl: p.id });
    }
    this.pearls.length = kept;
  }

  launch(id: number, vx: number, vy: number): void {
    const d = this.ducks.find((k) => k.id === id);
    if (!d) return;
    d.vx = vx;
    d.vy = vy;
    d.live = true;
    d.ticksMoving = 0;
    // a fired duck is a MOVE, not an arrival — it plays by every rule from
    // the first pixel, so whatever spawn shield it still carried is spent
    d.spawnShieldTicks = 0;
    // the player aimed this shot at a duck, so the duck it reaches first is
    // owed a full-strength hit however oblique the contact turns out to be
    d.shotStrikePending = true;
    this.phase = 0; // the new shot flies clean until it touches something
    this.events.push({ type: 'duckLaunched', id });
  }

  step(dt: number): void {
    this.time += dt;

    // contact-damage cooldowns tick down once per fixed step
    for (const b of this.barrels) {
      if (b.hitCooldown > 0) b.hitCooldown--;
    }
    // …and so does every fresh arrival's spawn shield
    for (const d of this.ducks) {
      if (d.spawnShieldTicks > 0) d.spawnShieldTicks--;
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
        // a shot that ran out of momentum without reaching a duck has spent its
        // strike: the privilege belongs to the shot in flight, not to the duck
        // it leaves sitting there
        d.shotStrikePending = false;
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
    this.tickClams();
  }

  /**
   * One fixed step == one fuse tick. Runs after the substeps, mirroring the
   * official's tick order: a duck flagged by a contact this tick is already
   * down to MATCH_FUSE_TICKS - 1 by the time the view first sees it.
   */
  private tickFuses(): void {
    // A doomed duck is never popped mid-glide: whatever lit it, it keeps full
    // physics while it blinks, and only detonates once it has been DEAD STILL
    // (the step snaps sub-STOP_SPEED motion to exactly zero) for a whole
    // confirmation hold — the player watches it flash, sees it come to rest,
    // and only then does it go. Contact matches additionally burn their full
    // fuse first, so a pair that was already sitting still blinks for the whole
    // MATCH_FUSE_TICKS; a blast victim's blink lasts however long it takes to
    // settle. The fuse keeps counting into the negatives meanwhile, which
    // keeps the blink bands alternating however long that is, and drag
    // guarantees every duck does come to rest.
    //
    // EVERY DUCK ON ITS OWN CLOCK (user-locked 2026-08-08, replacing the
    // one-bang rule of 2026-08-07). A doomed duck pops as soon as IT is ready
    // and waits for nothing else on the board. It was previously held until the
    // last of its generation was ready so a blast that caught four paid out as a
    // single bang; that cost a chain the time of its slowest victim on every
    // rung, and this is an ad, where those tenths are the whole budget. The
    // stutter that rule was written to remove is accepted: the fuse is 0.6s now
    // rather than the official 1.5s, so the spread between victims is far
    // smaller than it was when the trade was first made.
    //
    // This terminates: nothing new can be doomed without a pop or a contact,
    // drag brings every duck to rest, and the fuse counts past zero — so a duck
    // that is merely waiting always becomes ready.
    //
    // Decide-then-pop, in two passes, for the same reason it always was: a
    // pop's blast SHOVES its neighbours, so deciding inside the pop loop would
    // let the first pop knock a duck already judged ready back to zero — and
    // which ducks that hit would depend on iteration order.
    const ready: Duck[] = [];
    for (const d of this.ducks) {
      if (!d.matched || d.popping) continue;
      d.matchFuse--; // drives the blink band; runs past 0 while settling
      d.settleTicks = d.vx === 0 && d.vy === 0 ? d.settleTicks + 1 : 0;
      const held = d.settleTicks >= SIM.BLAST_SETTLE_CONFIRM_TICKS;
      if (held && (d.popOnSettle || d.matchFuse <= 0)) ready.push(d);
    }
    for (const d of ready) {
      if (!d.popping) this.popDuck(d);
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
          // THE PLAYER'S SHOT LANDS AT FULL STRENGTH (user-locked 2026-08-07).
          //
          // The impulse above is the ordinary equal-mass one, so what it hands
          // the target scales with `rel` — the NORMAL component of the approach.
          // A shot that catches its target off-centre therefore barely moved it:
          // measured over 1045 campaign shots, a graze sent the duck away at a
          // quarter of what a dead-centre hit did (see SIM.SHOT_STRIKE_SPEED).
          // The player aimed at that duck, so the angle should choose the
          // DIRECTION it leaves in and nothing else.
          //
          // The target's velocity is REPLACED, not added to — "always the same
          // strength" cannot survive being summed with whatever drift the duck
          // already had. The shooter keeps the ordinary impulse it just took;
          // this deliberately does not conserve momentum, because it is a feel
          // rule, not a physical one.
          //
          // ONE contact per shot. The flag is spent here, so the carom, the
          // struck duck's own collisions and every chain generation downstream
          // fall straight back to the plain impulse — which is what keeps a
          // chain reading as a consequence rather than as a second shot.
          const striker = a.shotStrikePending ? a : (b.shotStrikePending ? b : null);
          if (striker) {
            const target = striker === a ? b : a;
            // the normal runs a -> b, so it points INTO b and away from a
            const sx = striker === a ? nx : -nx;
            const sy = striker === a ? ny : -ny;
            target.vx = sx * SIM.SHOT_STRIKE_SPEED;
            target.vy = sy * SIM.SHOT_STRIKE_SPEED;
            a.shotStrikePending = false;
            b.shotStrikePending = false;
          }
          // Report the contact. NO cooldown state here, unlike the barrels and
          // clams, because the impulse above is self-debouncing: it only runs on
          // rel < 0 and leaves rel = -RESTITUTION_BODY·rel > 0, i.e. separating,
          // so the next substep cannot re-fire on the same physical collision.
          // A third body shoving the pair back together does produce rel < 0
          // again, and that IS a new collision. BUMP_MIN_SPEED then only has to
          // reject settling jitter. (Asserted, not trusted — see the substep-spam
          // test in tests/sim/world.test.ts.)
          if (-rel >= SIM.BUMP_MIN_SPEED) {
            this.events.push({
              type: 'duckBumped', a: a.id, b: b.id,
              x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, speed: -rel,
            });
          }
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
    // A duck already burning a fuse cannot RECRUIT a spawn-shielded arrival:
    // that contact is the tail of an explosion the arrival predates (a blast
    // victim slamming into the replacement its own chain booked). A clean
    // pair — neither on a fuse — still matches even inside the window; the
    // shield is against chains in progress, not against play. Decided BEFORE
    // any flagging, or flagging a would make b's partner-check read "doomed".
    const aShielded = a.spawnShieldTicks > 0 && b.matched;
    const bShielded = b.spawnShieldTicks > 0 && a.matched;
    if (!aShielded) this.flagMatched(a);
    if (!bShielded) this.flagMatched(b);
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
          // A CRATE THAT IS TOUCHED ALWAYS FLINCHES. Reported here, on the
          // bounce itself, and NOT down in the damage branch below — that
          // branch answers "did this cost it a stage", which is a different
          // question with a speed bar and a cooldown on it. Hanging the flinch
          // off it meant a glancing touch, or a second duck arriving within
          // 0.2s of the first, bounced off a crate that did not move: 70 of 705
          // campaign contacts, one of them at 1880 px/s.
          //
          // No cooldown of its own, for the reason duck-duck needs none: the
          // resolver has just snapped the duck out to exactly `minD` and turned
          // vn positive, so the pair is separating and the next of the 2-16
          // adaptive substeps finds them apart and cannot re-fire. Measured
          // 706 firings across 705 physical collisions.
          this.events.push({ type: 'barrelBumped', id: b.id, x: d.x, y: d.y, speed: -vn });
          // A TOUCH IS A TOUCH: every contact costs a stage (user-locked
          // 2026-08-07). This sits INSIDE the bounce, on the same `vn < 0` the
          // bounce and the flinch use, because there is only one question here
          // — did a duck reach this crate — and it should only ever be asked
          // once. It used to sit outside on its own bar, `vn < -90`, and `vn`
          // is the NORMAL component: a duck arriving hard but shallow carries
          // most of its speed tangentially, so it cleared no bar and bounced
          // off a crate it had not scratched. Measured over a head-on..grazing
          // sweep: silent at 200px/s dead centre, and silent at 1400px/s on a
          // graze. The floor now is STOP_SPEED, which the sim already enforces
          // by snapping anything slower to exactly zero — a duck resting
          // against a crate has vn == 0 and is not approaching at all.
          //
          // The debounce is per DUCK. Keyed on the barrel alone it swallowed a
          // second duck's separate hit for a fifth of a second (25 of 70 silent
          // contacts in the campaign measurement); keyed on the pair it still
          // does the only job it was ever for, which is stopping ONE physical
          // collision counting twice across the 2-16 adaptive substeps.
          if (b.hitCooldown === 0 || b.hitBy !== d.id) {
            b.hitCooldown = SIM.BARREL_HIT_COOLDOWN_TICKS;
            b.hitBy = d.id;
            this.damageBarrel(b, 1);
          }
        }
      }
    }
  }

  /**
   * Clams are solid bumpers whether shut, open or spent (the rig IS the game's
   * bumper), so this ALWAYS bounces — the deflection is level geometry and must
   * not change when a clam goes inert. Any approach at all additionally triggers
   * an armed one, mirroring the official's `caseContact`: bounce off static,
   * then hit the case.
   *
   * The debounce is per duck and lasts exactly one fixed step: adaptive
   * substepping runs this up to 16 times per step, so without it one physical
   * collision could spend two pearls. Deliberately no longer than that — see
   * the note on the trigger itself.
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
        const speed = Math.hypot(d.vx, d.vy);
        const vn = d.vx * nx + d.vy * ny;
        if (vn < 0) {
          // FLING, not reflect. The barrels' half-energy bounce is wrong for
          // this rig — it is the game's pinball bumper. Same shape as the wall
          // bumper kick in collideWalls: the tangential glide survives untouched
          // and the outgoing normal speed is a fixed kick plus a share of the
          // duck's TOTAL speed, so a graze is still redirected hard and a
          // head-on slam comes back nearly as fast as it arrived.
          const tx = d.vx - vn * nx, ty = d.vy - vn * ny;
          const kick = SIM.CLAM_KICK + SIM.CLAM_KEEP * speed;
          d.vx = tx + nx * kick;
          d.vy = ty + ny * kick;
          const out = Math.hypot(d.vx, d.vy);
          if (out > SIM.MAX_SPEED) {
            const f = SIM.MAX_SPEED / out;
            d.vx *= f;
            d.vy *= f;
          }
          this.events.push({ type: 'bumperHit', id: c.id, x: d.x, y: d.y });
          // ONE CONTACT, ONE ROUTINE, EVERY TIME. The shell reacting and the
          // shell paying out are the same event, so they are decided by the same
          // test — this sits inside the react rather than beside it, and there
          // is now nothing left in the test but "is this shell still armed".
          //
          // Two gates have been removed from here, both for the same reason: a
          // duck reached the shell, the shell visibly reacted, and nothing came
          // out. First `vn < -CLAM_HIT_SPEED`, which read the NORMAL component,
          // so a duck arriving hard but glancing cleared the react's bar and
          // missed the payout's. Then `!c.open`, the whole 60-tick cycle, which
          // was 48% of every contact the bot made across the campaign — the
          // shell simply ignored the second duck for a full second.
          //
          // What is left is the substep debounce and nothing else: the collision
          // runs 2-16 times per fixed step, so ONE physical collision can
          // register as an approach twice inside a step (measured: 15 of 5353).
          // Keyed per DUCK and cleared every step in tickClams, so it can only
          // ever swallow the duplicate — never a second duck, and never the same
          // duck's next real approach, which is the mistake the removed gates
          // both made. 95% of contacts now run the routine and the rest are
          // shells the level has already spent; reproduce the before/after with
          // shots/probe-clam-misses.mjs and shots/probe-clam-verify.mjs.
          if (c.active && !c.hitThisStep.includes(d.id)) {
            c.hitThisStep.push(d.id);
            this.hitClam(c);
          }
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
      // a fresh arrival still inside its spawn shield is not here yet as far
      // as THIS explosion is concerned: the chain predates the duck, and
      // conscripting it on touchdown is exactly the accidental generation the
      // shield exists to stop (user-set 2026-08-08). No doom, no shove.
      if (d.spawnShieldTicks > 0) continue;
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
    // A POP OPENS THE SHELLS IT CATCHES (user-set 2026-08-07). Same reach and
    // same test as the barrels above — pure centre distance <= BLAST_R — and the
    // same routine a duck landing on the shell runs, so a caught clam jolts open
    // and spills exactly one pearl.
    //
    // This reverses an earlier removal, and the reasoning that removed it still
    // holds as a description: a blast reaches BLAST_R 135 from the pop's centre
    // against a CLAM_R of 56, so a shell can be opened by a duck that never came
    // within ~79px of it, and when this last shipped 1266 of 2114 pearls came out
    // on proximity rather than contact. That is now the intended behaviour: the
    // explosion is meant to crack shells near it, not only under it.
    //
    // No debounce needed, unlike collideDuckClams: blast() is called once per
    // pop from tickFuses, not per substep, so one detonation cannot pay twice.
    // hitClam already refuses a spent shell.
    for (const c of this.clams) {
      if (Math.hypot(c.x - x, c.y - y) <= SIM.BLAST_R) this.hitClam(c);
    }
  }
}
