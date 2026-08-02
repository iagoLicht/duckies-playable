import { Application, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { Spine } from '@esotericsoftware/spine-pixi-v8';
import { loadSkeleton, makeSpine } from './engine/spineLoader';

import duckySkelUrl from './assets/entities/ducky/ducky.skel';
import duckyAtlasText from './assets/entities/ducky/ducky.atlas?raw';
import duckyPageUrl from './assets/entities/ducky/ducky.webp';
import crateSkelUrl from './assets/entities/crate-round/crate-round.skel';
import crateAtlasText from './assets/entities/crate-round/crate-round.atlas?raw';
import cratePageUrl from './assets/entities/crate-round/crate-round.webp';
import handJsonUrl from './assets/entities/tutorial-hand/tutorial-hand.json?url';
import handAtlasText from './assets/entities/tutorial-hand/tutorial-hand.atlas?raw';
import handPageUrl from './assets/entities/tutorial-hand/tutorial-hand.webp';
import wallTileUrl from './assets/theme/bath-wall-tile.webp';
import poolTileUrl from './assets/theme/bath-pool-blue.webp';
import triBottomUrl from './assets/entities/wall-bouncers/BouncyWall-triangle-bottom.webp';
import barHorizUrl from './assets/entities/wall-bouncers/BouncyWall-wall-horizontal.webp';

export const DESIGN_W = 720;
export const DESIGN_H = 1280;

function fitCanvas(app: Application): void {
  const scale = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H);
  app.canvas.style.width = `${DESIGN_W * scale}px`;
  app.canvas.style.height = `${DESIGN_H * scale}px`;
}

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    width: DESIGN_W,
    height: DESIGN_H,
    backgroundColor: 0xf8dfe4,
    preference: 'webgl',
    antialias: false,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    roundPixels: true,
  });
  app.ticker.maxFPS = 60;
  document.getElementById('game')!.appendChild(app.canvas);
  fitCanvas(app);
  window.addEventListener('resize', () => fitCanvas(app));
  // visualViewport is the listener that actually fires on mobile URL-bar collapse
  window.visualViewport?.addEventListener('resize', () => fitCanvas(app));

  // pink mosaic backdrop — a clean grout-aligned patch of the original
  // in-game-bg tiled full-screen, so no cropped bathroom props (plant, sink,
  // slippers, towel) appear outside the tub. tileScale matches the cover-fit
  // scale the full bg previously rendered at (1280/1050)
  const bgImg = new Image();
  bgImg.src = wallTileUrl;
  await bgImg.decode();
  const bg = new TilingSprite({
    texture: Texture.from(bgImg),
    width: DESIGN_W,
    height: DESIGN_H,
  });
  bg.tileScale.set(1280 / 1050);
  app.stage.addChild(bg);

  // ── bathtub ──────────────────────────────────────────────────────────────
  // The real game's tub silhouette: straight top edge set between "shoulder"
  // corners that step down and bulge outward into the side edges; plain rounded
  // corners at the bottom. No tub texture exists in the asset pack (the game
  // builds the rim from level poolPolygons + a gradient map that isn't shipped),
  // so the shape is traced procedurally to match the gameplay reference.
  const tub = { l: 26, t: 200, r: 694, b: 1254, s: 52, d: 60 };
  const traceTub = (g: Graphics, o: number): Graphics => {
    // o > 0 shrinks the path inward; o < 0 grows it outward
    const l = tub.l + o, t = tub.t + o, r = tub.r - o, b = tub.b - o;
    const { s, d } = tub;
    const rc = 18; // small top-corner arc
    const rb = 46 - o; // bottom corner radius
    g.moveTo(l + s + rc, t);
    g.lineTo(r - s - rc, t);
    g.arcTo(r - s, t, r - s, t + rc, rc);
    g.lineTo(r - s, t + d - rc);
    g.bezierCurveTo(r - s, t + d + 18, r, t + d, r, t + d + 26);
    g.lineTo(r, b - rb);
    g.arcTo(r, b, r - rb, b, rb);
    g.lineTo(l + rb, b);
    g.arcTo(l, b, l, b - rb, rb);
    g.lineTo(l, t + d + 26);
    g.bezierCurveTo(l, t + d, l + s, t + d + 18, l + s, t + d - rc);
    g.lineTo(l + s, t + rc);
    g.arcTo(l + s, t, l + s + rc, t, rc);
    g.closePath();
    return g;
  };

  // water tiles, clipped to the tub interior
  const poolImg = new Image();
  poolImg.src = poolTileUrl;
  await poolImg.decode();
  const water = new TilingSprite({
    texture: Texture.from(poolImg),
    width: DESIGN_W,
    height: DESIGN_H,
  });
  water.tileScale.set(1.3); // tile pitch ≈ the example's 1.35 world units at our ppu
  const waterMask = traceTub(new Graphics(), 10).fill(0xffffff);
  water.mask = waterMask;
  app.stage.addChild(water, waterMask);

  // white ring hugging the inside wall — same hand-drawn sticker style as the
  // white base under every entity: NOT a perfect stroke. The boundary is sampled
  // into a polyline and each point is nudged by smooth low-frequency wobble, and
  // a soft darker water-shadow line runs just inside it.
  const tubRingPoints = (o: number): Array<{ x: number; y: number }> => {
    const l = tub.l + o, t = tub.t + o, r = tub.r - o, b = tub.b - o;
    const { s, d } = tub;
    const rc = 18;
    const rb = 46 - o;
    const pts: Array<{ x: number; y: number }> = [];
    const line = (x1: number, y1: number, x2: number, y2: number): void => {
      const n = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 26));
      for (let i = 0; i < n; i++) pts.push({ x: x1 + ((x2 - x1) * i) / n, y: y1 + ((y2 - y1) * i) / n });
    };
    const arc = (cx: number, cy: number, rad: number, a1: number, a2: number): void => {
      for (let i = 0; i < 8; i++) {
        const a = a1 + ((a2 - a1) * i) / 8;
        pts.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) });
      }
    };
    const bez = (
      p0: [number, number], c1: [number, number], c2: [number, number], p1: [number, number],
    ): void => {
      for (let i = 0; i < 10; i++) {
        const u = i / 10, v = 1 - u;
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
  };
  const wobble = (pts: Array<{ x: number; y: number }>, amp: number): Array<{ x: number; y: number }> => {
    // deterministic smooth noise along the perimeter, pushed toward the tub centre
    const cx = (tub.l + tub.r) / 2, cy = (tub.t + tub.b) / 2;
    let dist = 0;
    let prev = pts[0] ?? { x: 0, y: 0 };
    return pts.map((p) => {
      dist += Math.hypot(p.x - prev.x, p.y - prev.y);
      prev = p;
      // gentle large-scale undulation (wavelengths ~200-1200px) — the entity
      // bases have smooth blobby edges, not high-frequency wiggle
      const n = amp * (Math.sin(dist * 0.012) * 0.8 + Math.sin(dist * 0.031 + 2.1) * 0.5 + Math.sin(dist * 0.0052 + 0.7) * 0.6);
      const dx = cx - p.x, dy = cy - p.y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / len) * n, y: p.y + (dy / len) * n };
    });
  };
  // soft feathered shadow (like the blurred shadow pieces in the entity sheets):
  // faked with concentric strokes at falling widths / rising alpha
  const shadowPts = wobble(tubRingPoints(26), 2.6).map((p) => ({ x: p.x, y: p.y + 3 }));
  const ringShadow = new Graphics();
  for (const [w, a] of [[14, 0.07], [10, 0.1], [6, 0.14]] as const) {
    ringShadow.poly(shadowPts).stroke({ width: w, color: 0x2a6d92, alpha: a, join: 'round', cap: 'round' });
  }
  const ringWhite = new Graphics()
    .poly(wobble(tubRingPoints(18), 2.6))
    .stroke({ width: 13, color: 0xffffff, join: 'round', cap: 'round' });
  app.stage.addChild(ringShadow, ringWhite);

  // rim band: navy outline sandwich, near-white band, cool shadow along the
  // inner edge — colours matched to the gameplay reference
  const tubFrame = new Graphics();
  traceTub(tubFrame, 0).stroke({ width: 30, color: 0x1a2430 });
  traceTub(tubFrame, 0).stroke({ width: 24, color: 0xa9c6cc });
  traceTub(tubFrame, -2).stroke({ width: 17, color: 0xe4eef1 });
  app.stage.addChild(tubFrame);

  // wall bouncers — pink jelly deflectors mounted flush on the tub's inner wall
  // (flat edge against the border, slope facing the water), like the real game
  const loadTex = async (url: string): Promise<Texture> => {
    const img = new Image();
    img.src = url;
    await img.decode();
    return Texture.from(img);
  };
  const innerFace = 24; // border centerline -> inner face (navy 15 + white ring 9)
  const triLeft = new Sprite(await loadTex(triBottomUrl));
  triLeft.anchor.set(0, 0.5);
  triLeft.scale.set(0.6);
  triLeft.position.set(tub.l + innerFace - 8, 950);
  // exact mirror of the left triangle: same art flipped horizontally, mounted at
  // the symmetric position on the right wall, same height
  const triRight = new Sprite(triLeft.texture);
  triRight.anchor.set(0, 0.5);
  triRight.scale.set(-0.6, 0.6);
  triRight.position.set(DESIGN_W - (tub.l + innerFace - 8), 950);
  const bar = new Sprite(await loadTex(barHorizUrl));
  bar.anchor.set(0.5, 0);
  bar.scale.set(0.7);
  // the art has ~29px transparent padding above the pill at this scale — offset
  // so the opaque top edge tucks 4px into the border
  bar.position.set(480, tub.t + innerFace - 33);
  app.stage.addChild(triLeft, triRight, bar);

  const spines: Spine[] = [];
  const add = (s: Spine, x: number, y: number, scale: number): Spine => {
    s.position.set(x, y);
    s.scale.set(scale);
    app.stage.addChild(s);
    spines.push(s);
    return s;
  };

  // ── THE SPIKE: four colour skins from one rig ────────────────────────────
  const duckyData = await loadSkeleton({
    skelUrl: duckySkelUrl, atlasText: duckyAtlasText, pageUrl: duckyPageUrl,
  });
  // two loose rows, colours mixed and positions slightly irregular so the flock
  // reads as floating naturally rather than lined up
  const ducks = [
    { skin: 'green', x: 175, y: 360 },
    { skin: 'red', x: 455, y: 345 },
    { skin: 'yellow', x: 285, y: 485 },
    { skin: 'purple', x: 550, y: 470 },
  ] as const;
  ducks.forEach(({ skin, x, y }, i) => {
    const duck = makeSpine(duckyData);
    duck.skeleton.setSkinByName(skin);
    duck.skeleton.setSlotsToSetupPose();
    duck.state.setAnimation(0, 'idle', true);
    duck.state.timeScale = 0.8 + i * 0.13; // desync the bobbing so it's obviously live
    add(duck, x, y, 0.9);
  });

  // THE barrel (crate-round): clasps strip off per hit — hp3..hp1 damage walk,
  // then one looping `hit` wobble so the impact reaction is visible too
  const crateData = await loadSkeleton({
    skelUrl: crateSkelUrl, atlasText: crateAtlasText, pageUrl: cratePageUrl,
  });
  (['hp3', 'hp2', 'hp1'] as const).forEach((stage, i) => {
    const c = makeSpine(crateData);
    c.skeleton.setSkinByName('wood');
    c.skeleton.setSlotsToSetupPose();
    c.state.setAnimation(0, stage, false);
    add(c, 120 + i * 165, 1090, 0.85);
  });
  const wobbler = makeSpine(crateData);
  wobbler.skeleton.setSkinByName('wood');
  wobbler.skeleton.setSlotsToSetupPose();
  wobbler.state.setAnimation(0, 'hit', true);
  add(wobbler, 615, 1090, 0.85);

  // colour-skinned barrels (full clasps) — note: no green skin exists on this rig
  (['yellow', 'red'] as const).forEach((skin, i) => {
    const c = makeSpine(crateData);
    c.skeleton.setSkinByName(skin);
    c.skeleton.setSlotsToSetupPose();
    c.state.setAnimation(0, 'hp5', false);
    add(c, 250 + i * 220, 800, 0.85);
  });

  // tutorial hand, tapping
  const handData = await loadSkeleton({
    jsonUrl: handJsonUrl, atlasText: handAtlasText, pageUrl: handPageUrl,
  });
  const hand = makeSpine(handData);
  hand.state.setAnimation(0, 'tap', true);
  add(hand, 360, 600, 0.25);

  // one central tick for every skeleton (autoUpdate is off)
  app.ticker.add((t) => {
    const dt = t.deltaMS / 1000;
    for (const s of spines) s.update(dt);
  });

  // deterministic readiness signal for the screenshot harness
  (window as unknown as { __sceneReady?: boolean }).__sceneReady = true;
}

boot().catch((e: unknown) => {
  // surface boot failures — a swallowed rejection here is a blank screen with no clue,
  // and console.error is exactly what the screenshot harness's gate listens for
  console.error('boot failed', e);
});
