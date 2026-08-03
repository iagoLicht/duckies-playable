import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import {
  Skin, type Attachment, type Color, type SkeletonData, type Spine,
} from '@esotericsoftware/spine-pixi-v8';
import { Director } from '../sim/director';
import { SIM } from '../sim/config';
import type { AimPreview } from '../sim/trajectory';
import type { Barrel, Colour, Duck, SimEvent } from '../sim/types';
import { loadSkeleton, makeSpine } from '../engine/spineLoader';

import duckySkelUrl from '../assets/entities/ducky/ducky.skel';
import duckyAtlasText from '../assets/entities/ducky/ducky.atlas?raw';
import duckyPageUrl from '../assets/entities/ducky/ducky.webp';
import crateSkelUrl from '../assets/entities/crate-round/crate-round.skel';
import crateAtlasText from '../assets/entities/crate-round/crate-round.atlas?raw';
import cratePageUrl from '../assets/entities/crate-round/crate-round.webp';
import handJsonUrl from '../assets/entities/tutorial-hand/tutorial-hand.json?url';
import handAtlasText from '../assets/entities/tutorial-hand/tutorial-hand.atlas?raw';
import handPageUrl from '../assets/entities/tutorial-hand/tutorial-hand.webp';
import starUrl from '../assets/vfx/impact-star.webp';
import blobUrl from '../assets/vfx/explode-particle.webp';

const DUCK_SCALE = 0.9;
const BARREL_SCALE = 0.85;

const COLOURS: readonly Colour[] = ['yellow', 'green', 'purple', 'red'];
const TINTS: Record<Colour, number> = {
  yellow: 0xffd94d, green: 0x5cc80e, purple: 0xa44aed, red: 0xec273f,
};
/** the same hues pulled nearly all the way to white — the reference frame's
 *  splash is white with only a whisper of the popped body's hue, and anything
 *  more saturated reads as a grubby smear against the blue water */
const BURST_TINTS: Record<Colour, number> = (() => {
  const wash = (c: number): number => {
    const ch = (sh: number): number => {
      const v = (c >> sh) & 0xff;
      return Math.round(v + (255 - v) * 0.85) << sh;
    };
    return ch(16) | ch(8) | ch(0);
  };
  return { yellow: wash(TINTS.yellow), green: wash(TINTS.green), purple: wash(TINTS.purple), red: wash(TINTS.red) };
})();

// Duck spine tracks. The body idle, the selection ring and the ring's slow spin
// drive disjoint bones/slots, so they layer cleanly on separate tracks.
const T_BODY = 0;
const T_RING = 1;
const T_SPIN = 2;
/** explode_vfx runs 0.17s — a hair more so its last frame lands before destroy */
const POP_TIME = 0.2;

// ── pop feel, lifted from the official example (decomp GameScene.onPop) ──────
/** star tint on a pop: their warm-white `Yn(..., 16773304)` burst */
const POP_STAR_TINT = 0xffe9b8;
/** additive flash: their duck-tinted `foam` image, 30 -> 70 px over 220ms QuadOut */
const FLASH_R0 = 15, FLASH_R1 = 35, FLASH_TIME = 0.22, FLASH_ALPHA = 0.75;
/** their `time2.freeze(scene, 40)` — 40ms of dead sim while the vfx play on */
const HITSTOP = 0.04;
/** their `cameras.main.shake(70, 0.003)`; Phaser scales intensity by camera size */
const SHAKE_TIME = 0.07, SHAKE_INTENSITY = 0.003;
const DESIGN_W = 720, DESIGN_H = 1280;
/** their `hit()`: 1.22x scale punch over 100ms, yoyo, Quad.easeOut */
const PUNCH_SCALE = 1.22, PUNCH_TIME = 0.1;
/** their match burst is the pop burst at 0.7 */
const MATCH_BURST = 0.7;

const quadOut = (t: number): number => 1 - (1 - t) * (1 - t);

// aim visuals (official example): dots crawl forward along the projected path
const DOT_SPACING = 36;
const DOT_START = 38;
const DOT_MAX = 32;
const DOT_CRAWL = 100; // px/s
const DEFLECT_LEN = 90;

/** Decode an image URL (path or data URI) into a Pixi texture — same one code
 *  path for dev URLs and the build's inlined data URIs. */
async function loadTexture(url: string): Promise<Texture> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return Texture.from(img);
}

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
  private duckyData!: SkeletonData;
  private crateData!: SkeletonData;
  /** per-colour "duck + ring bones" skin, built once (see init) */
  private duckSkins = new Map<Colour, Skin>();
  /** duck ids currently wearing the green selection ring */
  private ringed = new Set<number>();
  private starTex!: Texture;
  /** soft white disc standing in for the official's blurred `foam` sprite */
  private blobTex!: Texture;
  /** duck ids currently whited-out by the match blink */
  private flashOn = new Set<number>();
  /** per-duck isolated attachment colours backing the current white band */
  private flashSlots = new Map<number, Array<{ color: Color; orig: [number, number, number, number] }>>();
  /** seconds of hitstop left — the sim is dead while this is positive */
  private hitstop = 0;
  /** seconds of camera shake left */
  private shake = 0;
  private accumulator = 0;
  /** monotonic clock driving the aim dot crawl */
  private aimClock = 0;
  /** pointerId that owns the current grab — other pointers are ignored */
  private activePointer: number | null = null;

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
    this.starTex = await loadTexture(starUrl);
    this.blobTex = await loadTexture(blobUrl);
    this.app.stage.addChild(this.layer, this.fx, this.aimLine);

    // The rig's `active-ring` skin ships ZERO attachments — it exists to carry the
    // ring BONES (active-ring, active-ring-scale, active-ring-scale4, active-ring2).
    // Without it those bones are inactive and the `active` animation's attachment
    // timelines silently no-op, so every duck wears colour + ring-bones combined.
    const ringSkin = this.duckyData.findSkin('active-ring');
    if (!ringSkin) throw new Error('ducky rig is missing the active-ring skin');
    for (const c of COLOURS) {
      const colourSkin = this.duckyData.findSkin(c);
      if (!colourSkin) throw new Error(`ducky rig is missing the ${c} skin`);
      const combined = new Skin(`${c}+ring`);
      combined.addSkin(colourSkin);
      combined.addSkin(ringSkin);
      this.duckSkins.set(c, combined);
    }

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
      if (this.activePointer !== null) return; // a grab is in flight — ignore extra fingers
      const p = e.getLocalPosition(stage);
      if (!this.director.slingshot.begin(p.x, p.y)) return;
      this.activePointer = e.pointerId;
      if (this.hand) this.hand.visible = false; // tutorial done
    });
    stage.on('pointermove', (e) => {
      if (e.pointerId !== this.activePointer) return;
      const p = e.getLocalPosition(stage);
      this.director.slingshot.move(p.x, p.y);
    });
    const up = (e: { pointerId: number }): void => {
      if (e.pointerId !== this.activePointer) return;
      this.activePointer = null;
      this.director.slingshot.end();
      this.aimLine.clear();
    };
    stage.on('pointerup', up);
    stage.on('pointerupoutside', up);
    stage.on('pointercancel', (e) => {
      if (e.pointerId !== this.activePointer) return;
      this.activePointer = null;
      this.director.slingshot.cancel(); // cancelled: drop the grab without firing
      this.aimLine.clear();
    });
  }

  private tick(dt: number): void {
    this.aimClock += dt;
    if (this.hitstop > 0) {
      // Official hitstop: `time2.freeze` zeroes the SIM's timescale only — the
      // decomp's GameScene.update gates `sim.update` and nothing else, so the
      // pop's own vfx and the spine rigs keep playing through the 40ms.
      this.hitstop = Math.max(0, this.hitstop - dt);
    } else {
      // fixed-step the sim regardless of render rate
      this.accumulator += Math.min(dt, 0.1);
      while (this.accumulator >= SIM.DT) {
        this.director.step(SIM.DT);
        this.accumulator -= SIM.DT;
      }
    }
    this.drainEvents();
    // one trajectory probe per frame — the rings and the aim UI both read it
    const pv = this.director.slingshot.preview();
    this.syncViews(dt);
    this.syncRings(pv);
    this.drawAim(pv);
    this.syncShake(dt);
  }

  /**
   * Phaser's camera shake, ported: a fresh uniform offset every frame for the
   * duration (no falloff), scaled by the viewport, snapping back to zero at the
   * end. The stage is otherwise always at the origin.
   */
  private syncShake(dt: number): void {
    if (this.shake <= 0) return;
    this.shake -= dt;
    if (this.shake <= 0) {
      this.shake = 0;
      this.app.stage.position.set(0, 0);
      return;
    }
    this.app.stage.position.set(
      (Math.random() * 2 - 1) * SHAKE_INTENSITY * DESIGN_W,
      (Math.random() * 2 - 1) * SHAKE_INTENSITY * DESIGN_H,
    );
  }

  /**
   * Green ring == "you can grab this duck". Per-duck, so resting ducks keep
   * their rings while another one flies. While aiming the board goes quiet:
   * every ring hides except the one on the duck the trajectory will hit.
   */
  private syncRings(pv: AimPreview | null): void {
    const aiming = this.director.slingshot.aiming;
    const target = aiming && pv?.hitKind === 'duck' ? pv.hitId : null;
    for (const d of this.director.world.ducks) {
      const v = this.duckViews.get(d.id);
      if (!v) continue;
      // a matched duck is spoken for: no ring, it can't be grabbed any more
      this.setRing(d.id, v, aiming ? d.id === target : !d.live && !d.popping && !d.matched);
    }
  }

  private setRing(id: number, v: Spine, on: boolean): void {
    if (this.ringed.has(id) === on) return;
    if (on) {
      this.ringed.add(id);
      // `active` attaches the ring to its slots and scales it in; it doesn't loop,
      // so the entry holds the last frame and the ring simply stays up
      v.state.setAnimation(T_RING, 'active', false);
    } else {
      this.ringed.delete(id);
      // mixing out to empty restores the setup pose — i.e. detaches the ring
      v.state.setEmptyAnimation(T_RING, 0);
    }
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
      case 'duckMatched': {
        const v = this.duckViews.get(e.id);
        const d = this.director.world.ducks.find((k) => k.id === e.id);
        if (v && d) {
          // official hit(): the rig's own `jump`, then back to idle
          v.state.setAnimation(T_BODY, 'jump', false);
          v.state.addAnimation(T_BODY, 'idle', true, 0);
          this.punch(v);
          this.burst(d.x, d.y, BURST_TINTS[d.colour], MATCH_BURST);
        }
        break;
      }
      case 'duckPopped': {
        const v = this.duckViews.get(e.id);
        if (v) {
          this.duckViews.delete(e.id);
          this.ringed.delete(e.id);
          this.popDuck(v);
        }
        this.flashOn.delete(e.id);
        this.flashSlots.delete(e.id);
        this.burst(e.x, e.y, POP_STAR_TINT, 1);
        this.popFlash(e.x, e.y, e.colour);
        this.hitstop = HITSTOP;
        this.shake = SHAKE_TIME;
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
            const step = tk.deltaMS / 1000;
            t += step;
            // it left barrelViews, so syncViews no longer ticks it and autoUpdate
            // is off — drive the hp0 break pose here or it freezes mid-fade
            v.update(step);
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
    s.skeleton.setSkin(this.duckSkins.get(d.colour)!);
    s.skeleton.setSlotsToSetupPose();
    s.state.setAnimation(T_BODY, 'idle', true);
    // one turn per 12s. It runs from birth and is never restarted, so the ring's
    // rotation is continuous across selections instead of snapping back to 0 —
    // and while no ring is attached it drives invisible bones for free.
    s.state.setAnimation(T_SPIN, 'spin_ring', true);
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

  /**
   * The duck's own death animation: `explode` is a 0-length pose that blows the
   * head up, `explode_vfx` then scales the whole rig out over 0.17s. The view has
   * already left duckViews (its sim duck is gone, so syncViews can't position or
   * tick it) — drive it here, exactly like the barrel's hp0 fade.
   */
  private popDuck(v: Spine): void {
    v.state.clearTracks(); // drop idle + ring + spin so nothing fights the pose
    v.skeleton.setToSetupPose();
    v.state.setAnimation(0, 'explode', false);
    v.state.setAnimation(1, 'explode_vfx', false);
    v.state.timeScale = 1;
    let t = 0;
    const run = (tk: { deltaMS: number }): void => {
      const step = tk.deltaMS / 1000;
      t += step;
      v.update(step);
      if (t >= POP_TIME) {
        this.app.ticker.remove(run);
        v.destroy();
      }
    };
    this.app.ticker.add(run);
  }

  /** Star splash — the shipped impact-star. `k` scales it (matches use 0.7). */
  private burst(x: number, y: number, tint: number, k = 1): void {
    const s = new Sprite(this.starTex);
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.tint = tint;
    s.rotation = (x + y) % Math.PI; // vary the spike angles pop to pop
    this.fx.addChild(s);
    let t = 0;
    const anim = (tk: { deltaMS: number }): void => {
      t += tk.deltaMS / 1000;
      const p = Math.min(1, t / 0.26);
      // fast out, slow settle. The 289px star ends ~115px across — a shade wider
      // than the 92px duck, like the reference splash; bigger just smears.
      s.scale.set((0.16 + 0.24 * quadOut(p)) * k);
      // hold full while the duck is still blowing up, then fade
      s.alpha = p < 0.35 ? 1 : 1 - (p - 0.35) / 0.65;
      if (p >= 1) {
        this.app.ticker.remove(anim);
        s.destroy();
      }
    };
    this.app.ticker.add(anim);
  }

  /** Additive duck-tinted bloom at the pop — the official's `foam` flash. */
  private popFlash(x: number, y: number, colour: Colour): void {
    const s = new Sprite(this.blobTex);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.tint = TINTS[colour];
    s.position.set(x, y);
    this.fx.addChild(s);
    let t = 0;
    const anim = (tk: { deltaMS: number }): void => {
      t += tk.deltaMS / 1000;
      const p = Math.min(1, t / FLASH_TIME);
      const e = quadOut(p);
      s.width = s.height = (FLASH_R0 + (FLASH_R1 - FLASH_R0) * e) * 2;
      s.alpha = FLASH_ALPHA * (1 - e);
      if (p >= 1) {
        this.app.ticker.remove(anim);
        s.destroy();
      }
    };
    this.app.ticker.add(anim);
  }

  /** Squash-free scale punch on a matched duck — the official's `hit()` tween. */
  private punch(v: Spine): void {
    let t = 0;
    const anim = (tk: { deltaMS: number }): void => {
      t += tk.deltaMS / 1000;
      if (v.destroyed) {
        this.app.ticker.remove(anim);
        return;
      }
      // out then back, Quad.easeOut each leg (Phaser yoyo re-runs the ease)
      const leg = t < PUNCH_TIME ? t / PUNCH_TIME : 1 - (t - PUNCH_TIME) / PUNCH_TIME;
      const k = 1 + (PUNCH_SCALE - 1) * quadOut(Math.max(0, leg));
      v.scale.set(DUCK_SCALE * k);
      if (t >= PUNCH_TIME * 2) {
        this.app.ticker.remove(anim);
        v.scale.set(DUCK_SCALE);
      }
    };
    this.app.ticker.add(anim);
  }

  /**
   * Match blink. The official whites the duck out by copying every attachment
   * and forcing its colour to opaque white (decomp isolateAttachmentsForFlash +
   * syncMatchFlash) — this rig is built the same way, with the duck's hue living
   * in the attachment colours over neutral art, so the same trick lands the same
   * flat-white silhouette. Attachments are shared across every duck of a colour,
   * hence the per-instance copy. Re-isolated at each white band so an animation
   * that swapped an attachment mid-fuse can't strand a slot.
   */
  private syncMatchFlash(d: Duck, v: Spine): void {
    const on = d.matched && Math.floor(d.matchFuse / SIM.MATCH_BLINK_TICKS) % 2 === 0;
    if (on === this.flashOn.has(d.id)) return;
    if (on) {
      const slots: Array<{ color: Color; orig: [number, number, number, number] }> = [];
      for (const slot of v.skeleton.slots) {
        const att = slot.getAttachment() as (Attachment & { color?: Color; copy?: () => Attachment }) | null;
        if (!att?.color || typeof att.copy !== 'function') continue;
        const copy = att.copy() as Attachment & { color: Color };
        slot.setAttachment(copy);
        slots.push({ color: copy.color, orig: [copy.color.r, copy.color.g, copy.color.b, copy.color.a] });
      }
      for (const s of slots) s.color.set(1, 1, 1, 1);
      this.flashSlots.set(d.id, slots);
      this.flashOn.add(d.id);
    } else {
      for (const s of this.flashSlots.get(d.id) ?? []) {
        s.color.set(s.orig[0], s.orig[1], s.orig[2], s.orig[3]);
      }
      this.flashSlots.delete(d.id);
      this.flashOn.delete(d.id);
    }
  }

  private flashBlast(x: number, y: number, r: number, colour: Colour): void {
    // secondary now: barrel-damage feedback behind the rig's explode vfx
    const g = new Graphics().circle(x, y, r).stroke({ width: 10, color: TINTS[colour], alpha: 0.5 });
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
        if (d.matched) this.syncMatchFlash(d, v);
        v.update(dt);
      }
    }
    for (const [, v] of this.barrelViews) v.update(dt);
    if (this.hand?.visible) this.hand.update(dt);
  }

  /**
   * Official aim visuals: a crawling dotted trajectory (one wall bounce), a red
   * X where the path dead-ends into nothing, and a white billiards deflection
   * streak off a struck duck. The X is advisory — release still fires.
   */
  private drawAim(pv: AimPreview | null): void {
    this.aimLine.clear();
    if (!pv) return;

    // --- dots along the polyline ---
    const segs: Array<{ x0: number; y0: number; ux: number; uy: number; len: number }> = [];
    let total = 0;
    for (let i = 0; i + 1 < pv.points.length; i++) {
      const a = pv.points[i]!, b = pv.points[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len <= 0) continue;
      segs.push({ x0: a.x, y0: a.y, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len, len });
      total += len;
    }
    const offset = (this.aimClock * DOT_CRAWL) % DOT_SPACING;
    for (let n = 0; n < DOT_MAX; n++) {
      const arc = DOT_START + offset + n * DOT_SPACING;
      if (arc > total) break;
      // locate arc along the polyline
      let rem = arc;
      let s = 0;
      while (s < segs.length - 1 && rem > segs[s]!.len) {
        rem -= segs[s]!.len;
        s++;
      }
      const seg = segs[s]!;
      const g = total > 0 ? arc / total : 0;
      this.aimLine
        .circle(seg.x0 + seg.ux * rem, seg.y0 + seg.uy * rem, (18 - 5.4 * g) / 2)
        .fill({ color: 0xffffff, alpha: 1 - 0.3 * g });
    }

    const endPt = pv.points[pv.points.length - 1]!;

    // --- red X where the shot hits nothing ---
    if (pv.hitId === null) {
      const a = 20 / Math.SQRT2; // arm extent 20 along each diagonal
      const stroke = { width: 12, color: 0xE8354A, alpha: 0.95, cap: 'round' as const };
      this.aimLine
        .moveTo(endPt.x - a, endPt.y - a).lineTo(endPt.x + a, endPt.y + a).stroke(stroke)
        .moveTo(endPt.x + a, endPt.y - a).lineTo(endPt.x - a, endPt.y + a).stroke(stroke);
    }

    // --- white tapered streak off a struck duck (equal-mass billiards) ---
    if (pv.hitKind === 'duck' && pv.deflect) {
      const struck = this.director.world.ducks.find((d) => d.id === pv.hitId);
      if (struck) {
        const dx = pv.deflect.x, dy = pv.deflect.y;
        const bx = struck.x + dx * SIM.DUCK_R;
        const by = struck.y + dy * SIM.DUCK_R;
        const N = 4;
        for (let i = 0; i < N; i++) {
          const t0 = (i / N) * DEFLECT_LEN;
          const t1 = ((i + 1) / N) * DEFLECT_LEN;
          const w = 10 - (8 * (i + 0.5)) / N; // 10px at the duck -> 2px at the tip
          this.aimLine
            .moveTo(bx + dx * t0, by + dy * t0)
            .lineTo(bx + dx * t1, by + dy * t1)
            .stroke({ width: w, color: 0xffffff, alpha: 0.9, cap: 'round' });
        }
      }
    }
  }
}
