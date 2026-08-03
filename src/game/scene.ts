import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import {
  Skin, type Attachment, type Color, type SkeletonData, type Spine,
} from '@esotericsoftware/spine-pixi-v8';
import { Director } from '../sim/director';
import { LEVELS } from '../sim/levels';
import { SIM } from '../sim/config';
import type { AimPreview } from '../sim/trajectory';
import type { Barrel, Clam, Colour, Duck, SimEvent } from '../sim/types';
import { loadSkeleton, makeSpine } from '../engine/spineLoader';

import duckySkelUrl from '../assets/entities/ducky/ducky.skel';
import duckyAtlasText from '../assets/entities/ducky/ducky.atlas?raw';
import duckyPageUrl from '../assets/entities/ducky/ducky.webp';
import crateSkelUrl from '../assets/entities/crate-round/crate-round.skel';
import crateAtlasText from '../assets/entities/crate-round/crate-round.atlas?raw';
import cratePageUrl from '../assets/entities/crate-round/crate-round.webp';
import oysterSkelUrl from '../assets/entities/oyster/oyster.skel';
import oysterAtlasText from '../assets/entities/oyster/oyster.atlas?raw';
import oysterPageUrl from '../assets/entities/oyster/oyster.webp';
import pearlUrl from '../assets/entities/oyster/pearl.webp';
import handJsonUrl from '../assets/entities/tutorial-hand/tutorial-hand.json?url';
import handAtlasText from '../assets/entities/tutorial-hand/tutorial-hand.atlas?raw';
import handPageUrl from '../assets/entities/tutorial-hand/tutorial-hand.webp';
import starUrl from '../assets/vfx/impact-star.webp';
import blobUrl from '../assets/vfx/explode-particle.webp';
import aimDotUrl from '../assets/vfx/aim/aim-dot.webp';
import touchBgUrl from '../assets/vfx/aim/aim-touch-bg.webp';
import touchFrontUrl from '../assets/vfx/aim/aim-touch-front.webp';
import platePageUrl from '../assets/ui/hud-currency-plate.webp';
import goalIconUrl from '../assets/icons/goal-Barrel.webp';
import cherryBombUrl from '../assets/fonts/cherry-bomb.woff2';

const DUCK_SCALE = 0.9;
const BARREL_SCALE = 0.85;
/**
 * The oyster rig's SHELL art (its `base` attachment) is 198x188 — the rig's
 * 126x155 "size" is only the Spine editor viewport, and scaling to that reads
 * half again too big on the water. This puts the shell at ~115px across, a
 * shade over its 112px collision diameter, the same slight overhang the crate
 * and duck art carry over their own bodies.
 */
const CLAM_SCALE = 0.58;

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
/** looping water ripple under every duck, always on (official: track 2) */
const T_RIPPLE = 3;
/**
 * One-shot spawn_enter as a duck's view appears (official: track 22). It MUST
 * be mixed back out when it finishes: a completed non-looping track keeps
 * applying its final frame, and this one keys `master` + the `head*` bones —
 * held, it would outrank and freeze idle, jump, dance and the aim recoil.
 *
 * (The rig's `turn` anim — the official's frozen facing track — is deliberately
 * NOT used. Measured on this rig it rotates 50 bones, but for our plain colour
 * skins the visible ones are only the ring's: a duck at 0° and at 180° renders
 * identically, since `turn` mostly drives costume accessories no skin here
 * wears. Always-on it would also outrank head/body, killing the idle bob, the
 * match jump, dance, and the ring spin — all cost, no picture.)
 */
const T_SPAWN = 22;
// official spawn stagger: one duck view per 55ms, each entering with a
// 300ms Back.easeOut scale-up from ~zero plus a small white star splash
const SPAWN_STAGGER = 0.055;
const SPAWN_SCALE_TIME = 0.3;
/** a random settled duck dances every 2.8s (official idle-flavor timer) */
const DANCE_PERIOD = 2.8;
// how long the cleared/failed beat is allowed to play before the board swaps
const LEVEL_ADVANCE_DELAY = 1.8;
const LEVEL_RETRY_DELAY = 1.4;

// Clam spine tracks. The shell's state machine owns track 0 (inactive ->
// bump-inactive -> bump -> idle); the water ring loops forever beside it, the
// same split the ducks use.
const CT_SHELL = 0;
const CT_RIPPLE = 1;
/** the official's bumper-hit burst tint on this rig */
const CLAM_TINT = 0xFFB0D9;
/** `bump-inactive`'s authored length — the react beat, before the lid lifts */
const CLAM_REACT_TIME = 0.27;

// the pearl the shell spills: a quick Back.easeOut pop, a short rise as it
// fades in, then it hangs there breathing. It clears the shell's top rim
// (~55px above centre) with just enough overlap to read as coming out of it.
const PEARL_POP_TIME = 0.25;
const PEARL_RISE = 66;
const PEARL_RISE_TIME = 0.45;
const PEARL_BOB = 4;
const PEARL_BOB_PERIOD = 2.4;

/** Phaser's Back.easeOut, used by the official spawn pop-in */
const backOut = (t: number): number => {
  const s = 1.70158;
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
};
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

// aim visuals. Spacing/start/crawl are the official example's (0.4/0.42 ppu,
// 100 px/s); the dot size is the REAL game's — the reference video shows small
// ~11px dots of constant size, not the example's shrinking 18px discs.
const DOT_SPACING = 36;
const DOT_START = 38;
const DOT_MAX = 32;
const DOT_CRAWL = 100; // px/s
const DOT_SIZE = 11;
// deflection wedge geometry in duck-radii, traced from the reference video
// (wallBounce-HowToAim.mp4): base centre / control waist / tip along the
// deflect axis, base half-width, and how far in the concave edges pinch
const DEFLECT_BASE = 0.85;
const DEFLECT_WAIST = 1.5;
const DEFLECT_TIP = 2.3;
const DEFLECT_BASE_W = 0.6;
const DEFLECT_PINCH = 0.35;
// the red contact crescent on the aimed-at duck (reference video): the rig-pack
// aim-touch pills, white bg + red-tinted front, ~33px along the duck's rim
const CRESCENT_COLOR = 0xE8354A; // same red as the whiff X
const CRESCENT_SCALE = 0.55; // 60px-tall pill -> ~33px
/**
 * The rig's aim assembly root: rotating it swings the whole sling — teardrop
 * (tip authored along +x) AND the duck's pull-back recoil (master, authored -x)
 * — toward the launch direction. The `aim` anim itself is a STRETCH TIMELINE:
 * t=0 no pull, t=0.33s full pull. We freeze it and scrub trackTime by how far
 * the player has dragged, which is what the reference footage shows (short pull
 * = small round ring, long pull = long teardrop + recoiled duck).
 */
const AIM_BONE = 'a_target';
/** drag distance (px) that maps to the aim anim's full stretch */
const AIM_PULL_FULL = 260;
/** even the shortest valid pull shows some stretch (reference: s044 small oval) */
const AIM_PULL_MIN_T = 0.22;
/** the anim's tail recoils the duck art way off its spot — the reference never
 *  shows more than a moderate pull-back, so the scrub tops out early */
const AIM_PULL_MAX_T = 0.65;

// ── HUD ─────────────────────────────────────────────────────────────────────
// Everything lives in the strip ABOVE the tub (main.ts puts the rim at y=200),
// so the counters can never sit over the playfield. The plate is the pack's own
// 291x116 currency plate and the type is its Cherry Bomb display face.
/** the family name we register the woff2 under — the file's own is irrelevant */
const HUD_FONT = 'CherryBomb';
const HUD_ROW_Y = 112;
const MOVES_X = 360;
const MOVES_PLATE_SCALE = 0.72;
const GOAL_X = 566;
const GOAL_PLATE_SCALE = 0.5;
/** the counter number punches this big for a beat whenever it changes */
const HUD_PUNCH = 1.3, HUD_PUNCH_TIME = 0.12;

/** Decode an image URL (path or data URI) into a Pixi texture — same one code
 *  path for dev URLs and the build's inlined data URIs. */
async function loadTexture(url: string): Promise<Texture> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return Texture.from(img);
}

/**
 * Remaining hp IS the visible damage stage, and the rig's pose names line up
 * exactly: hpN shows N-1 metal straps. 3 hp = two straps (hp3), 2 hp = one
 * strap (hp2), 1 hp = bare planks (hp1). Every hit steps down exactly one
 * stage. (hp4/hp5 poses — three and four straps — are deliberately unused:
 * two straps is the deepest stage this game deals.)
 */
function stageFor(b: { hp: number }): string {
  return b.hp >= 3 ? 'hp3' : b.hp === 2 ? 'hp2' : 'hp1';
}

export class GameScene {
  /** rebuilt by loadLevel() as the campaign advances */
  director: Director;
  private duckViews = new Map<number, Spine>();
  private barrelViews = new Map<number, Spine>();
  private clamViews = new Map<number, Spine>();
  private layer = new Container();
  private fx = new Container();
  /** counters, always on top and always above the tub rim */
  private hud = new Container();
  private aimLine = new Graphics();
  private hand: Spine | null = null;
  private duckyData!: SkeletonData;
  private crateData!: SkeletonData;
  private oysterData!: SkeletonData;
  private pearlTex!: Texture;
  /** per-colour "duck + ring bones + aim bones" skin, built once (see init) */
  private duckSkins = new Map<Colour, Skin>();
  /** what each duck's ring track is showing: absent = nothing */
  private ringMode = new Map<number, 'ring' | 'aim'>();
  /** aim-teardrop rotation (deg, rig space) applied per duck before world transforms */
  private aimBoneRot = new Map<number, number>();
  /** pooled trajectory-dot sprites (official aim-dot), laid out each frame */
  private dotPool: Sprite[] = [];
  /** the aim UI layer — dots, crescent, X — sits UNDER the ducks like the official */
  private aimUnder = new Container();
  /** red contact crescent on the aimed-at duck: white pill under a red-tinted one */
  private crescent = new Container();
  private starTex!: Texture;
  /** soft white disc standing in for the official's blurred `foam` sprite */
  private blobTex!: Texture;
  /** sim ducks awaiting their staggered spawn view (official drainSpawnQueue) */
  private spawnQueue: Duck[] = [];
  /** seconds until the next queued spawn view may appear */
  private spawnTimer = 0;
  /** duck ids still inside the spawn scale-up (scale is theirs until it ends) */
  private spawning = new Set<number>();
  private danceTimer = 0;
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
  /** HUD readouts, built in init and driven purely by sim events */
  private movesText!: Text;
  private goalText!: Text;

  constructor(private app: Application, private seed: number, startLevel = 0) {
    // clamped so a stray ?level= can never ask the Director for a level that
    // does not exist (it throws) — the campaign just starts at the last one
    const i = Math.min(Math.max(0, startLevel), LEVELS.length - 1);
    this.director = new Director(seed + i, i);
  }

  async init(): Promise<void> {
    this.duckyData = await loadSkeleton({
      skelUrl: duckySkelUrl, atlasText: duckyAtlasText, pageUrl: duckyPageUrl,
    });
    this.crateData = await loadSkeleton({
      skelUrl: crateSkelUrl, atlasText: crateAtlasText, pageUrl: cratePageUrl,
    });
    this.oysterData = await loadSkeleton({
      skelUrl: oysterSkelUrl, atlasText: oysterAtlasText, pageUrl: oysterPageUrl,
    });
    this.starTex = await loadTexture(starUrl);
    this.blobTex = await loadTexture(blobUrl);
    this.pearlTex = await loadTexture(pearlUrl);

    // aim UI: official aim-dot sprites + the red contact crescent, all layered
    // UNDER the ducks (the official parks dots/cross at depth 6-8.5, ducks at 10+,
    // which is why the reference dots vanish cleanly behind the target duck)
    const aimDotTex = await loadTexture(aimDotUrl);
    for (let i = 0; i < DOT_MAX; i++) {
      const d = new Sprite(aimDotTex);
      d.anchor.set(0.5);
      d.width = DOT_SIZE;
      d.height = DOT_SIZE;
      d.visible = false;
      this.dotPool.push(d);
      this.aimUnder.addChild(d);
    }
    const cb = new Sprite(await loadTexture(touchBgUrl));
    cb.anchor.set(0.5);
    cb.scale.set(CRESCENT_SCALE);
    const cf = new Sprite(await loadTexture(touchFrontUrl));
    cf.anchor.set(0.5);
    cf.scale.set(CRESCENT_SCALE);
    cf.tint = CRESCENT_COLOR;
    this.crescent.addChild(cb, cf);
    this.crescent.visible = false;
    this.aimUnder.addChild(this.aimLine, this.crescent);
    this.app.stage.addChild(this.aimUnder, this.layer, this.fx, this.hud);
    await this.buildHud();

    // The rig's `active-ring` and `aim` skins ship ZERO attachments — they exist
    // to carry BONES (the circular selection ring's, and the drag teardrop's).
    // Without them those bones are inactive and the `active`/`aim` animations'
    // attachment timelines silently no-op, so every duck wears all three merged.
    const ringSkin = this.duckyData.findSkin('active-ring');
    const aimSkin = this.duckyData.findSkin('aim');
    if (!ringSkin || !aimSkin) throw new Error('ducky rig is missing the active-ring/aim skin');
    for (const c of COLOURS) {
      const colourSkin = this.duckyData.findSkin(c);
      if (!colourSkin) throw new Error(`ducky rig is missing the ${c} skin`);
      const combined = new Skin(`${c}+ring`);
      combined.addSkin(colourSkin);
      combined.addSkin(ringSkin);
      combined.addSkin(aimSkin);
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
      // the move budget is binding: with the last shot spent (or the level
      // already decided) the board is read-only — refuse before the sim ever
      // sees a grab, so no launch can slip past and drive movesLeft negative
      const d = this.director;
      if (d.movesLeft === 0 || d.won || d.failed) return;
      const p = e.getLocalPosition(stage);
      if (!d.slingshot.begin(p.x, p.y)) return;
      // a duck waiting in the spawn queue has no view yet: refuse the grab
      // rather than let the player sling an invisible duck
      const grabbed = this.director.slingshot.pull?.duck.id;
      if (grabbed === undefined || !this.duckViews.has(grabbed)) {
        this.director.slingshot.cancel();
        return;
      }
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
      const held = this.director.slingshot.pull?.duck.id ?? null;
      const fired = this.director.slingshot.end();
      if (fired && held !== null) {
        // the rig's own release snap-back on the launched duck
        const v = this.duckViews.get(held);
        if (v) {
          v.state.setAnimation(T_RING, 'aim_release', false);
          v.state.addEmptyAnimation(T_RING, 0.1, 0);
          this.ringMode.delete(held);
          this.aimBoneRot.delete(held);
        }
      }
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
    this.drainSpawnQueue(dt);
    this.tickDance(dt);
    // one trajectory probe per frame — the rings and the aim UI both read it
    const pv = this.director.slingshot.preview();
    this.syncViews(dt);
    this.syncRings(pv);
    this.drawAim(pv);
    this.syncShake(dt);
  }

  /**
   * Official idle-flavor: every 2.8s, while the board is settled, one random
   * duck does a little dance. The official gates on its 'aim' state, which it
   * only re-enters once every body is at rest AND no fuse is burning — so this
   * checks the same three things (`live` alone is not enough: a duck nudged by
   * a collision glides with `live` still false). View-only, so the Math.random
   * here can't perturb the deterministic sim.
   */
  private tickDance(dt: number): void {
    this.danceTimer += dt;
    if (this.danceTimer < DANCE_PERIOD) return;
    this.danceTimer = 0;
    const busy = this.director.world.ducks.some(
      (k) => k.live || k.matched || k.vx !== 0 || k.vy !== 0,
    );
    if (busy) return;
    const held = this.director.slingshot.pull?.duck.id;
    const ids = [...this.duckViews.keys()].filter(
      (id) => id !== held && !this.spawning.has(id),
    );
    if (ids.length === 0) return;
    const v = this.duckViews.get(ids[(Math.random() * ids.length) | 0]!)!;
    v.state.setAnimation(T_BODY, 'dance', false);
    v.state.addAnimation(T_BODY, 'idle', true, 0);
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
   * Reference-video ring rules. Board settled + nobody aiming: every grabbable
   * duck wears the circular green ring. While aiming: everything goes quiet
   * except the HELD duck, which swaps to the rig's `aim` teardrop, its tip
   * rotated live toward the launch direction. While anything is still sliding:
   * no rings at all (they return when the board comes to rest).
   */
  private syncRings(pv: AimPreview | null): void {
    const aiming = this.director.slingshot.aiming;
    const held = aiming ? this.director.slingshot.pull?.duck.id ?? null : null;
    const anyLive = this.director.world.ducks.some((k) => k.live);
    for (const d of this.director.world.ducks) {
      const v = this.duckViews.get(d.id);
      if (!v) continue;
      if (d.id === held) {
        this.setRingMode(d.id, v, 'aim');
      } else if (!aiming && !anyLive && !d.live && !d.popping && !d.matched) {
        // a matched duck is spoken for: no ring, it can't be grabbed any more
        this.setRingMode(d.id, v, 'ring');
      } else {
        this.setRingMode(d.id, v, null);
      }
    }
    // steer the sling: rotate the assembly toward the (assist-bent) launch
    // direction and scrub the stretch by how far the player has pulled
    if (held !== null) {
      const hv = this.duckViews.get(held);
      const pull = this.director.slingshot.pull;
      if (hv && pull) {
        if (pv && pv.points.length >= 2) {
          const a = pv.points[0]!, b = pv.points[1]!;
          const dx = b.x - a.x, dy = b.y - a.y;
          if (dx !== 0 || dy !== 0) {
            // rig space is y-up, stage y-down: negate the screen angle
            this.aimBoneRot.set(held, (-Math.atan2(dy, dx) * 180) / Math.PI);
          }
        }
        const entry = hv.state.getCurrent(T_RING);
        if (entry && entry.animation?.name === 'aim') {
          const t = Math.min(1, pull.len / AIM_PULL_FULL);
          const stretch = pull.len < SIM.MIN_PULL
            ? t * AIM_PULL_MIN_T // under the whiff threshold the sling barely wakes
            : AIM_PULL_MIN_T + t * (AIM_PULL_MAX_T - AIM_PULL_MIN_T);
          entry.trackTime = stretch * entry.animation.duration;
        }
      }
    }
  }

  private setRingMode(id: number, v: Spine, mode: 'ring' | 'aim' | null): void {
    const cur = this.ringMode.get(id) ?? null;
    if (cur === mode) return;
    if (mode === 'ring') {
      // `active` attaches the ring to its slots and scales it in; it doesn't loop,
      // so the entry holds the last frame and the ring simply stays up
      v.state.setAnimation(T_RING, 'active', false);
      this.ringMode.set(id, 'ring');
    } else if (mode === 'aim') {
      // frozen at t=0 — syncRings scrubs trackTime along the pull each frame
      const entry = v.state.setAnimation(T_RING, 'aim', false);
      entry.timeScale = 0;
      this.ringMode.set(id, 'aim');
    } else {
      // mixing out to empty restores the setup pose — i.e. detaches everything
      v.state.setEmptyAnimation(T_RING, 0);
      this.ringMode.delete(id);
      this.aimBoneRot.delete(id);
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
        // views appear one per 55ms via the spawn queue (official enqueueSpawn);
        // until then the sim duck exists with no view — every view lookup in
        // this file already tolerates that
        this.spawnQueue.push(e.duck);
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
          this.ringMode.delete(e.id);
          this.aimBoneRot.delete(e.id);
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
      case 'wallHit':
        if (e.source === 'bumper') this.burst(e.x, e.y, 0xffb459, 0.8);
        else this.wallFoam(e.x, e.y, e.nx, e.ny);
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
          // Reference (wallBounce f226-f240): the crate is gone almost at once
          // under a white puff with wood chips scattering; ~0.33s total. Play the
          // rig's authored 0.1s break, yank the alpha fast, and layer the puff.
          v.state.setAnimation(0, 'hp0', false);
          let t = 0;
          const fade = (tk: { deltaMS: number }): void => {
            const step = tk.deltaMS / 1000;
            t += step;
            // it left barrelViews, so syncViews no longer ticks it and autoUpdate
            // is off — drive the hp0 break pose here or it freezes mid-fade
            v.update(step);
            v.alpha = Math.max(0, 1 - t / 0.15);
            if (t >= 0.15) {
              this.app.ticker.remove(fade);
              v.destroy();
            }
          };
          this.app.ticker.add(fade);
        }
        this.crateBreak(e.x, e.y);
        break;
      }
      case 'clamSpawned':
        this.addClam(e.clam);
        break;
      case 'clamOpened':
        this.openClamView(e.id);
        break;
      case 'pearlReleased': {
        // the sim spills the pearl on the same tick it cracks the shell; hold it
        // back through the react beat so it emerges as the lid actually lifts
        // instead of sprouting out of a still-closed clam
        const { x, y } = e;
        this.after(CLAM_REACT_TIME, () => this.releasePearl(x, y));
        break;
      }
      case 'bumperHit':
        // fires on every glancing contact, so it stays to one cheap star
        this.burst(e.x, e.y, CLAM_TINT, 0.5);
        break;
      case 'levelStarted':
        console.log(`level ${e.index + 1}: ${e.name} — ${e.moves} moves`);
        break;
      case 'movesLeft':
        this.setCounter(this.movesText, String(e.left));
        break;
      case 'counter':
        this.setCounter(this.goalText, `${e.done}/${e.total}`);
        break;
      case 'levelCleared': {
        console.log(`level ${e.index + 1} CLEARED with ${e.movesLeft} moves to spare`);
        this.celebrate();
        const next = e.index + 1;
        // the campaign rolls straight on; the last level just stays cleared,
        // holding the celebration until an end card exists to take over
        if (next < LEVELS.length) this.after(LEVEL_ADVANCE_DELAY, () => this.loadLevel(next));
        break;
      }
      case 'levelFailed':
        console.log(`level ${e.index + 1} FAILED — out of moves`);
        this.lament();
        // a miss costs nothing but the retry — same board, fresh budget
        this.after(LEVEL_RETRY_DELAY, () => this.loadLevel(e.index));
        break;
      default:
        break; // finaleArmed/won ride on levelCleared; end-card UI is a later change
    }
  }

  /**
   * Swap the board for another level, keeping every loaded rig and texture.
   * Everything that keys off a duck/barrel/clam id has to go, because the next
   * Director starts its ids from 1 again — a surviving entry would be claimed by
   * an unrelated entity. In-flight fx are only unparented, not destroyed: they
   * are sub-second and their own ticker callbacks dispose of them, whereas
   * destroying them here would pull the rug out mid-tween.
   */
  loadLevel(index: number): void {
    for (const v of this.duckViews.values()) v.destroy();
    for (const v of this.barrelViews.values()) v.destroy();
    for (const v of this.clamViews.values()) v.destroy();
    this.duckViews.clear();
    this.barrelViews.clear();
    this.clamViews.clear();
    this.fx.removeChildren();
    if (this.hand) {
      this.fx.addChild(this.hand);
      this.hand.visible = index === 0; // the tutorial only greets level 1
    }
    this.spawnQueue.length = 0;
    this.spawnTimer = 0;
    this.spawning.clear();
    this.ringMode.clear();
    this.aimBoneRot.clear();
    this.flashOn.clear();
    this.flashSlots.clear();
    this.hitstop = 0;
    this.shake = 0;
    this.accumulator = 0;
    this.danceTimer = 0;
    this.activePointer = null;
    this.aimLine.clear();
    this.crescent.visible = false;
    for (const d of this.dotPool) d.visible = false;
    this.app.stage.position.set(0, 0); // drop any shake offset mid-flight

    // a per-level seed keeps every level's respawns deterministic on their own
    this.director = new Director(this.seed + index, index);
    this.director.start();
    this.drainEvents();
  }

  /** Take one duck off the spawn queue per stagger period and build its view. */
  private drainSpawnQueue(dt: number): void {
    this.spawnTimer -= dt;
    while (this.spawnTimer <= 0 && this.spawnQueue.length > 0) {
      const d = this.spawnQueue.shift()!;
      // every dequeue costs a slot, live or not, exactly like the official's
      // unconditional 55ms delayedCall — so the cadence never bunches up
      this.spawnTimer = SPAWN_STAGGER;
      // popped while still queued (a blast can doom a viewless duck), or a view
      // somehow already exists: drop it silently
      if (!this.director.world.ducks.includes(d) || this.duckViews.has(d.id)) continue;
      this.addDuck(d);
    }
    if (this.spawnQueue.length === 0 && this.spawnTimer < 0) this.spawnTimer = 0;
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
    // the water ripple loops forever under the duck; the desynced per-duck
    // timeScale (below) keeps the rings from pulsing in lockstep
    s.state.setAnimation(T_RIPPLE, 'ripple', true);
    s.state.timeScale = 0.8 + (d.id % 5) * 0.1;
    // entry: spawn_enter plays at TRUE speed (compensate the desync scale)
    // while the whole rig pops from ~zero with the official's Back overshoot.
    // The empty animation behind it releases `master`/`head*` when it ends.
    const enter = s.state.setAnimation(T_SPAWN, 'spawn_enter', false);
    enter.timeScale = 1 / s.state.timeScale;
    s.state.addEmptyAnimation(T_SPAWN, 0.1, 0);
    this.burst(d.x, d.y, 0xffffff, 0.7); // the official's white spawn splash
    s.scale.set(DUCK_SCALE * 0.001);
    this.spawning.add(d.id);
    let t = 0;
    const grow = (tk: { deltaMS: number }): void => {
      t += tk.deltaMS / 1000;
      // bail the moment the view stops being this duck's live view — popDuck
      // hands it to the explode animation, which owns the scale from then on
      if (s.destroyed || this.duckViews.get(d.id) !== s) {
        this.app.ticker.remove(grow);
        this.spawning.delete(d.id);
        return;
      }
      const k = Math.min(1, t / SPAWN_SCALE_TIME);
      s.scale.set(DUCK_SCALE * (0.001 + (1 - 0.001) * backOut(k)));
      if (k >= 1) {
        this.app.ticker.remove(grow);
        this.spawning.delete(d.id);
        s.scale.set(DUCK_SCALE);
      }
    };
    this.app.ticker.add(grow);
    s.position.set(d.x, d.y);
    // steer the aim teardrop after the animation is applied, before the world
    // transforms bake — the supported spine hook for per-frame bone overrides
    const bone = s.skeleton.findBone(AIM_BONE);
    if (bone) {
      const id = d.id;
      s.beforeUpdateWorldTransforms = () => {
        const rot = this.aimBoneRot.get(id);
        if (rot !== undefined) bone.rotation = rot;
      };
    }
    this.layer.addChild(s);
    this.duckViews.set(d.id, s);
  }

  private addBarrel(b: Barrel): void {
    const s = makeSpine(this.crateData);
    // every crate is the plain wooden one except the finale's prize, which wears
    // the rig's gold-toned skin so the last goal is the one you can see coming
    s.skeleton.setSkinByName(b.golden ? 'yellow' : b.skin);
    s.skeleton.setSlotsToSetupPose();
    s.state.setAnimation(0, stageFor(b), false);
    s.scale.set(BARREL_SCALE);
    s.position.set(b.x, b.y);
    this.layer.addChild(s);
    this.barrelViews.set(b.id, s);
  }

  /**
   * A shut, dormant clam. `inactive` is a ZERO-length pose animation: it swaps
   * the shell to its shut attachment set (eye/eye2 off, the dormant eye3/eye4
   * on, plus the `inactive-overlay2` closed-shell plate) and, being a completed
   * non-looping entry, simply holds that set until something opens it. The
   * water ring rides its own looping track exactly like the ducks'.
   */
  private addClam(c: Clam): void {
    const s = makeSpine(this.oysterData);
    s.skeleton.setSkinByName(c.skin);
    s.skeleton.setSlotsToSetupPose();
    s.state.setAnimation(CT_SHELL, 'inactive', false);
    // desync the ring the way the ducks do so neighbouring clams don't pulse in
    // lockstep — but on the TRACK, not the whole state: the shell's one-shots
    // must keep true speed, since the pearl is timed against their real length
    s.state.setAnimation(CT_RIPPLE, 'ripple', true).timeScale = 0.85 + (c.id % 5) * 0.08;
    s.scale.set(CLAM_SCALE);
    s.position.set(c.x, c.y);
    this.layer.addChild(s);
    this.clamViews.set(c.id, s);
  }

  /**
   * The crack-open beat, all of it the rig's own authored animation:
   *   `bump-inactive` (0.27s) — the react. Same shut attachment set, the
   *      `oyster` bone squashed: it jolts but stays closed.
   *   `bump` (0.30s) — the opening. It re-attaches the `face-up` lid at t=0,
   *      fades it to 0.34 alpha and REMOVES it (and `mouth-bottom`) at 0.30,
   *      bringing eye/eye2 back at 0.27. Net: the lid comes off, eyes pop.
   *   `idle` (loop) — the awake shell breathing.
   *
   * `bump` only touches those four slots, so coming straight out of the shut
   * set it would leave the closed-shell overlay and the dormant eyes stranded
   * on top of the opening. The setup pose IS the awake set (face-up and
   * mouth-bottom detached, eye/eye2 attached, no overlay), so each one-shot
   * hands over through a setSlotsToSetupPose() on its `complete` — before the
   * next animation is applied, since AnimationState drains its event queue
   * inside update() and the skeleton is only posed afterwards, in apply().
   * The same call on `bump`'s completion is the belt-and-braces guarantee that
   * the lid is gone even if the final attachment frame never lands.
   */
  private openClamView(id: number): void {
    const v = this.clamViews.get(id);
    if (!v) return;
    const awake = { complete: (): void => v.skeleton.setSlotsToSetupPose() };
    v.state.setAnimation(CT_SHELL, 'bump-inactive', false).listener = awake;
    v.state.addAnimation(CT_SHELL, 'bump', false, 0).listener = awake;
    v.state.addAnimation(CT_SHELL, 'idle', true, 0);
  }

  /**
   * The pearl the shell spills: the pack's 52x52 glossy bead, popped in with
   * the official's Back overshoot, rising clear of the shell as it fades up,
   * then left breathing on the water. It lives in `fx` so it sits above the
   * clam. Paired with the bumper's pink star and a foam bloom at the seam.
   */
  private releasePearl(x: number, y: number): void {
    this.burst(x, y, CLAM_TINT, 0.8);
    this.foamFlash(x, y, CLAM_TINT);
    const p = new Sprite(this.pearlTex);
    p.anchor.set(0.5);
    p.position.set(x, y);
    p.scale.set(0);
    p.alpha = 0;
    this.fx.addChild(p);
    let t = 0;
    const anim = (tk: { deltaMS: number }): void => {
      t += tk.deltaMS / 1000;
      p.scale.set(backOut(Math.min(1, t / PEARL_POP_TIME)));
      p.alpha = Math.min(1, t / PEARL_POP_TIME);
      const rise = quadOut(Math.min(1, t / PEARL_RISE_TIME)) * PEARL_RISE;
      // once the rise is spent the bob takes over from exactly where it ended,
      // so there is no seam between the two
      const bob = t < PEARL_RISE_TIME
        ? 0
        : PEARL_BOB * (1 - Math.cos(((t - PEARL_RISE_TIME) / PEARL_BOB_PERIOD) * Math.PI * 2)) / 2;
      p.y = y - rise + bob;
    };
    this.app.ticker.add(anim);
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

  /**
   * Official onWallHit: a soft foam smear at the contact point, widening as it
   * fades (their `foam` at alpha .5, 45×27 px growing to 81 wide, 240ms
   * QuadOut). Laid along the wall so it reads as displaced water.
   */
  private wallFoam(x: number, y: number, nx: number, ny: number): void {
    const s = new Sprite(this.blobTex);
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.rotation = Math.atan2(ny, nx) + Math.PI / 2; // long axis along the wall
    s.alpha = 0.5;
    s.width = 45;
    s.height = 27;
    this.fx.addChild(s);
    let t = 0;
    const anim = (tk: { deltaMS: number }): void => {
      t += tk.deltaMS / 1000;
      const p = Math.min(1, t / 0.24);
      s.width = 45 + 36 * quadOut(p);
      s.alpha = 0.5 * (1 - p);
      if (p >= 1) {
        this.app.ticker.remove(anim);
        s.destroy();
      }
    };
    this.app.ticker.add(anim);
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
    this.foamFlash(x, y, TINTS[colour]);
  }

  /** The bloom itself, at any tint — the clam's pearl uses the bumper pink. */
  private foamFlash(x: number, y: number, tint: number): void {
    const s = new Sprite(this.blobTex);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.tint = tint;
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

  /**
   * Crate destruction, matched to the reference footage (wallBounce f226-f240):
   * a soft white puff swallows the crate while wooden chips scatter, all
   * resolved in about a third of a second, with a small sparkle outliving it.
   */
  private crateBreak(x: number, y: number): void {
    // the puff: opaque white cloud, quick swell then dissolve
    const puff = new Sprite(this.blobTex);
    puff.anchor.set(0.5);
    puff.position.set(x, y);
    this.fx.addChild(puff);
    let pt = 0;
    const puffAnim = (tk: { deltaMS: number }): void => {
      pt += tk.deltaMS / 1000;
      const p = Math.min(1, pt / 0.3);
      puff.width = puff.height = (60 + 55 * quadOut(p)) * 2;
      puff.alpha = p < 0.4 ? 1 : 1 - (p - 0.4) / 0.6;
      if (p >= 1) {
        this.app.ticker.remove(puffAnim);
        puff.destroy();
      }
    };
    this.app.ticker.add(puffAnim);

    // wooden chips thrown outward, sinking slightly as they fade — the star
    // sprite tints clean (the blob's dark rim turns muddy at chip size)
    for (let i = 0; i < 6; i++) {
      const chip = new Sprite(this.starTex);
      chip.anchor.set(0.5);
      chip.rotation = i * 1.1;
      chip.tint = i % 2 === 0 ? 0xE08A3C : 0xB5722F;
      chip.width = chip.height = 18 + (i % 3) * 6;
      const ang = (i / 6) * Math.PI * 2 + 0.5;
      const speed = 320 + (i % 3) * 70;
      const vx = Math.cos(ang) * speed;
      let vy = Math.sin(ang) * speed - 60;
      chip.position.set(x + Math.cos(ang) * 30, y + Math.sin(ang) * 30);
      this.fx.addChild(chip);
      let ct = 0;
      const chipAnim = (tk: { deltaMS: number }): void => {
        const dt = tk.deltaMS / 1000;
        ct += dt;
        vy += 900 * dt; // chips arc down like the reference debris
        chip.x += vx * dt;
        chip.y += vy * dt;
        chip.alpha = Math.max(0, 1 - ct / 0.35);
        if (ct >= 0.35) {
          this.app.ticker.remove(chipAnim);
          chip.destroy();
        }
      };
      this.app.ticker.add(chipAnim);
    }

    // the little sparkle that hangs around after the puff clears
    this.burst(x - 15, y - 40, 0xffffff, 0.45);
  }

  /** Squash-free scale punch on a matched duck — the official's `hit()` tween. */
  private punch(v: Spine): void {
    // a duck still inside its spawn scale-up owns its own scale — punching it
    // would snap it to full size mid-entry
    for (const [id, dv] of this.duckViews) {
      if (dv === v && this.spawning.has(id)) return;
    }
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

  /**
   * The counters, built from the pack's own UI: the 291x116 currency plate as
   * the backing for both chips, the goal-Barrel icon overlapping the goal chip
   * the way the real HUD hangs its icons, and Cherry Bomb for the type.
   *
   * The whole row is pinned to the strip above the tub rim (y=200 in main.ts),
   * so it can never sit over live water.
   */
  private async buildHud(): Promise<void> {
    // Pixi rasterises text through the DOM's font set, so the face has to be
    // registered AND fully loaded before the first Text exists — a Text built
    // a frame early bakes a fallback-font texture and never re-renders itself.
    document.fonts.add(await new FontFace(HUD_FONT, `url("${cherryBombUrl}")`).load());

    const plateTex = await loadTexture(platePageUrl);
    const chip = (x: number, scale: number): Sprite => {
      const s = new Sprite(plateTex);
      s.anchor.set(0.5);
      s.scale.set(scale);
      s.position.set(x, HUD_ROW_Y);
      return s;
    };
    const label = (size: number, stroke: number): Text => {
      const t = new Text({
        text: '',
        style: {
          fontFamily: HUD_FONT, fontSize: size, fill: 0xffffff, align: 'center',
          stroke: { color: 0x2f2440, width: stroke, join: 'round' },
        },
      });
      t.anchor.set(0.5);
      return t;
    };

    const movesLabel = label(28, 6);
    movesLabel.text = 'MOVES';
    movesLabel.position.set(MOVES_X, HUD_ROW_Y - 68);
    this.movesText = label(54, 8);
    this.movesText.position.set(MOVES_X, HUD_ROW_Y);

    const goalIcon = new Sprite(await loadTexture(goalIconUrl));
    goalIcon.anchor.set(0.5);
    goalIcon.width = goalIcon.height = 66;
    goalIcon.position.set(GOAL_X - 58, HUD_ROW_Y - 2);
    this.goalText = label(34, 6);
    this.goalText.position.set(GOAL_X + 20, HUD_ROW_Y);

    this.hud.addChild(
      chip(MOVES_X, MOVES_PLATE_SCALE), movesLabel, this.movesText,
      chip(GOAL_X, GOAL_PLATE_SCALE), goalIcon, this.goalText,
    );
  }

  /** Set a counter and punch it, so a spent move or a cleared goal is felt. */
  private setCounter(t: Text, value: string): void {
    if (t.text === value) return;
    t.text = value;
    let e = 0;
    const anim = (tk: { deltaMS: number }): void => {
      e += tk.deltaMS / 1000;
      // out then back, Quad.easeOut each leg — the duck punch's shape
      const leg = e < HUD_PUNCH_TIME ? e / HUD_PUNCH_TIME : 1 - (e - HUD_PUNCH_TIME) / HUD_PUNCH_TIME;
      t.scale.set(1 + (HUD_PUNCH - 1) * quadOut(Math.max(0, leg)));
      if (e >= HUD_PUNCH_TIME * 2) {
        this.app.ticker.remove(anim);
        t.scale.set(1);
      }
    };
    this.app.ticker.add(anim);
  }

  /**
   * Level cleared. No end-card and no transition — a later change owns those;
   * this only has to make the state unmistakable: a staggered wash of stars
   * over the tub and a longer version of the pop's own camera shake.
   */
  private celebrate(): void {
    this.shake = SHAKE_TIME * 4;
    // a ring of stars blooming outward from the middle of the tub, alternating
    // the pop's warm white with the clam's pink
    for (let i = 0; i < 8; i++) {
      this.after(i * 0.07, () => {
        const a = (i / 8) * Math.PI * 2 + 0.4;
        this.burst(
          DESIGN_W / 2 + Math.cos(a) * 210, 740 + Math.sin(a) * 250,
          i % 2 === 0 ? POP_STAR_TINT : CLAM_TINT, 1.3,
        );
      });
    }
  }

  /**
   * Level failed: deliberately the opposite shape — no stars, no shake, one
   * slow cold ring sinking over the board that nobody could mistake for a win.
   */
  private lament(): void {
    const x = DESIGN_W / 2, y = 740;
    const g = new Graphics().circle(x, y, 90).stroke({ width: 14, color: 0x2f5f80, alpha: 0.55 });
    this.fx.addChild(g);
    let t = 0;
    const anim = (tk: { deltaMS: number }): void => {
      t += tk.deltaMS / 1000;
      const p = Math.min(1, t / 0.6);
      g.alpha = 1 - p;
      g.scale.set(1 + quadOut(p) * 1.6);
      g.pivot.set((x * (g.scale.x - 1)) / g.scale.x, (y * (g.scale.y - 1)) / g.scale.y);
      if (p >= 1) {
        this.app.ticker.remove(anim);
        g.destroy();
      }
    };
    this.app.ticker.add(anim);
    this.foamFlash(x, y, 0x3d6f8f);
  }

  /** Run `fn` once, `delay` seconds out, on the app ticker — the file's only
   *  scheduler, so anything queued pauses with the tab like the rest of the fx. */
  private after(delay: number, fn: () => void): void {
    let t = 0;
    const wait = (tk: { deltaMS: number }): void => {
      t += tk.deltaMS / 1000;
      if (t < delay) return;
      this.app.ticker.remove(wait);
      fn();
    };
    this.app.ticker.add(wait);
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
    // clams never move, but the shut pose, the open beats and the water ring
    // all need ticking (autoUpdate is off on every rig in this scene)
    for (const [, v] of this.clamViews) v.update(dt);
    if (this.hand?.visible) this.hand.update(dt);
  }

  /**
   * Reference-video aim visuals: crawling aim-dot sprites along the projected
   * path (one wall bounce), a red X wherever the path fails to reach a duck
   * (empty space, wall, or a barrel blocking the lane), the red contact
   * crescent hugging the aimed-at duck's rim, and a white billiards deflection
   * streak off a struck duck. The X is BINDING — releasing on it refuses the
   * shot (Slingshot.end() re-checks the same trajectory).
   */
  private drawAim(pv: AimPreview | null): void {
    this.aimLine.clear();
    let dotsUsed = 0;
    if (!pv) {
      for (const d of this.dotPool) d.visible = false;
      this.crescent.visible = false;
      return;
    }

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
      const dot = this.dotPool[dotsUsed++]!;
      dot.visible = true;
      dot.position.set(seg.x0 + seg.ux * rem, seg.y0 + seg.uy * rem);
      dot.alpha = 1 - 0.3 * g;
    }
    for (let n = dotsUsed; n < DOT_MAX; n++) this.dotPool[n]!.visible = false;

    const endPt = pv.points[pv.points.length - 1]!;

    // --- red contact crescent on the aimed-at duck's rim ---
    if (pv.hitKind === 'duck') {
      const struck = this.director.world.ducks.find((d) => d.id === pv.hitId);
      if (struck) {
        const vx = endPt.x - struck.x, vy = endPt.y - struck.y;
        const len = Math.hypot(vx, vy) || 1;
        const ux = vx / len, uy = vy / len;
        this.crescent.visible = true;
        // past the physics radius so it clears the duck ART (~57px at this scale)
        // and sits on the ripple, like the reference frames
        this.crescent.position.set(
          struck.x + ux * (SIM.DUCK_R + 22), struck.y + uy * (SIM.DUCK_R + 22),
        );
        // pill art is vertical, convex side +x: point the bulge away from the duck
        this.crescent.rotation = Math.atan2(uy, ux);
      } else {
        this.crescent.visible = false;
      }
    } else {
      this.crescent.visible = false;
    }

    // --- red X wherever the shot fails to reach a duck ---
    if (pv.hitKind !== 'duck') {
      const a = 20 / Math.SQRT2; // arm extent 20 along each diagonal
      const stroke = { width: 12, color: 0xE8354A, alpha: 0.95, cap: 'round' as const };
      this.aimLine
        .moveTo(endPt.x - a, endPt.y - a).lineTo(endPt.x + a, endPt.y + a).stroke(stroke)
        .moveTo(endPt.x + a, endPt.y - a).lineTo(endPt.x - a, endPt.y + a).stroke(stroke);
    }

    // --- white deflection wedge on a struck duck (equal-mass billiards) ---
    // The real game's arrow (wallBounce-HowToAim.mp4 ~4.7-5.1s): a solid-white
    // speech-bubble-tail — wide rounded base tucked UNDER the duck art (this
    // layer sits below the ducks, so the base fuses with the duck's white base
    // ring), both edges gently concave, sharp tip ~2.3 duck-radii from the
    // centre. Static: no pulse, it only rotates with the predicted direction.
    if (pv.hitKind === 'duck' && pv.deflect) {
      const struck = this.director.world.ducks.find((d) => d.id === pv.hitId);
      if (struck) {
        const dx = pv.deflect.x, dy = pv.deflect.y;
        const px = -dy, py = dx; // unit perpendicular
        const R = SIM.DUCK_R;
        const w = R * DEFLECT_BASE_W;
        const at = (along: number, side: number): { x: number; y: number } => ({
          x: struck.x + dx * R * along + px * w * side,
          y: struck.y + dy * R * along + py * w * side,
        });
        const b1 = at(DEFLECT_BASE, 1);
        const b2 = at(DEFLECT_BASE, -1);
        const c1 = at(DEFLECT_WAIST, DEFLECT_PINCH);
        const c2 = at(DEFLECT_WAIST, -DEFLECT_PINCH);
        const tip = at(DEFLECT_TIP, 0);
        this.aimLine
          .moveTo(b1.x, b1.y)
          .quadraticCurveTo(c1.x, c1.y, tip.x, tip.y)
          .quadraticCurveTo(c2.x, c2.y, b2.x, b2.y)
          .closePath()
          .fill({ color: 0xffffff, alpha: 0.95 });
      }
    }
  }
}
