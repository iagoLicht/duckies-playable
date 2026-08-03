import { Application, Container, Graphics } from 'pixi.js';
import type { SkeletonData, Spine } from '@esotericsoftware/spine-pixi-v8';
import { Director } from '../sim/director';
import { SIM } from '../sim/config';
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

const DUCK_SCALE = 0.9;
const BARREL_SCALE = 0.85;

// aim visuals (official example): dots crawl forward along the projected path
const DOT_SPACING = 36;
const DOT_START = 38;
const DOT_MAX = 32;
const DOT_CRAWL = 100; // px/s
const DEFLECT_LEN = 90;

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

  /**
   * Official aim visuals: a crawling dotted trajectory (one wall bounce), a red
   * X where the path dead-ends into nothing, and a white billiards deflection
   * streak off a struck duck. The X is advisory — release still fires.
   */
  private drawAim(): void {
    this.aimLine.clear();
    const pv = this.director.slingshot.preview();
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
