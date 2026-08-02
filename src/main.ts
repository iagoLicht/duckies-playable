import { Application, Container, Graphics, Texture, TilingSprite } from 'pixi.js';
import type { Spine } from '@esotericsoftware/spine-pixi-v8';
import { loadSkeleton, makeSpine } from './engine/spineLoader';

import duckySkelUrl from './assets/entities/ducky/ducky.skel';
import duckyAtlasText from './assets/entities/ducky/ducky.atlas?raw';
import duckyPageUrl from './assets/entities/ducky/ducky.webp';
import crateSkelUrl from './assets/entities/crate-round/crate-round.skel';
import crateAtlasText from './assets/entities/crate-round/crate-round.atlas?raw';
import cratePageUrl from './assets/entities/crate-round/crate-round.webp';
import fwBaseSkelUrl from './assets/entities/firework-base/firework-base.skel';
import fwBaseAtlasText from './assets/entities/firework-base/firework-base.atlas?raw';
import fwBasePageUrl from './assets/entities/firework-base/firework-base.webp';
import fwRocketSkelUrl from './assets/entities/firework-rocket/firework-rocket.skel';
import fwRocketAtlasText from './assets/entities/firework-rocket/firework-rocket.atlas?raw';
import fwRocketPageUrl from './assets/entities/firework-rocket/firework-rocket.webp';
import handJsonUrl from './assets/entities/tutorial-hand/tutorial-hand.json?url';
import handAtlasText from './assets/entities/tutorial-hand/tutorial-hand.atlas?raw';
import handPageUrl from './assets/entities/tutorial-hand/tutorial-hand.webp';
import wallTileUrl from './assets/theme/bath-wall-tile.webp';
import poolTileUrl from './assets/theme/bath-pool-blue.webp';

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

  // white ground-shadow ring hugging the inside wall of the tub — same sticker
  // style as the white base under every entity. Drawn over the water, clipped to
  // the tub interior, then the frame covers its outer half: ~9px shows against
  // the water, flush with the frame's inner edge
  const tubHalo = traceTub(new Graphics(), 0).stroke({ width: 48, color: 0xffffff });
  const haloMask = traceTub(new Graphics(), 10).fill(0xffffff);
  tubHalo.mask = haloMask;
  app.stage.addChild(tubHalo, haloMask);

  // rim band: navy outline sandwich, near-white band, cool shadow along the
  // inner edge — colours matched to the gameplay reference
  const tubFrame = new Graphics();
  traceTub(tubFrame, 0).stroke({ width: 30, color: 0x1a2430 });
  traceTub(tubFrame, 0).stroke({ width: 24, color: 0xa9c6cc });
  traceTub(tubFrame, -2).stroke({ width: 17, color: 0xe4eef1 });
  app.stage.addChild(tubFrame);

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
  const colors = ['yellow', 'green', 'purple', 'red'] as const;
  colors.forEach((skin, i) => {
    const duck = makeSpine(duckyData);
    duck.skeleton.setSkinByName(skin);
    duck.skeleton.setSlotsToSetupPose();
    duck.state.setAnimation(0, 'idle', true);
    duck.state.timeScale = 0.8 + i * 0.13; // desync the bobbing so it's obviously live
    add(duck, 130 + i * 155, 420, 0.9);
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
    add(c, 120 + i * 165, 640, 0.85);
  });
  const wobbler = makeSpine(crateData);
  wobbler.skeleton.setSkinByName('wood');
  wobbler.skeleton.setSlotsToSetupPose();
  wobbler.state.setAnimation(0, 'hit', true);
  add(wobbler, 615, 640, 0.85);

  // colour-skinned barrels (full clasps) — note: no green skin exists on this rig
  (['yellow', 'purple', 'red'] as const).forEach((skin, i) => {
    const c = makeSpine(crateData);
    c.skeleton.setSkinByName(skin);
    c.skeleton.setSlotsToSetupPose();
    c.state.setAnimation(0, 'hp5', false);
    add(c, 175 + i * 185, 800, 0.85);
  });

  // firework crate with its rocket stock stored inside, matching the reference
  // playable's composition: crate first, then rockets on top in two rows — back row
  // higher/larger, front row lower/smaller, fanned ±5°, bases sunk into the foam
  const fwBaseData = await loadSkeleton({
    skelUrl: fwBaseSkelUrl, atlasText: fwBaseAtlasText, pageUrl: fwBasePageUrl,
  });
  // No `idle` on this rig, so it stays in setup pose. The DEFAULT skin renders foam
  // only — the crate attachments are present but invisible; the `big` skin is the one
  // that actually shows the crate (skins here are size variants, not colours).
  const crate = { x: 360, y: 1030, w: 235 }; // w ≈ rendered width of 'big' at 0.8
  const fwBase = makeSpine(fwBaseData);
  fwBase.skeleton.setSkinByName('big');
  fwBase.skeleton.setSlotsToSetupPose();
  add(fwBase, crate.x, crate.y, 0.8);

  const rocketData = await loadSkeleton({
    skelUrl: fwRocketSkelUrl, atlasText: fwRocketAtlasText, pageUrl: fwRocketPageUrl,
  });
  // 2 back + 2 front, staggered so every colour reads; back row higher and larger,
  // front row sunk toward the front wall — offsets are fractions of crate width,
  // taken from the reference playable's crate composition
  // Rockets sit deep in the crate per the gameplay reference: only heads + a bit
  // of neck show above the foam. The crate's foam/front wall are one spine layer
  // UNDER the rockets, so the "stored inside" look comes from clipping the rocket
  // layer at the front-wall top edge — bodies and bases never show.
  const rocketLayer = new Container();
  const rocketClip = new Graphics()
    .rect(crate.x - crate.w, crate.y - crate.w, crate.w * 2, crate.w + 0.05 * crate.w)
    .fill(0xffffff);
  rocketLayer.mask = rocketClip;
  const stock = ['red', 'green', 'purple', 'yellow'] as const;
  stock.forEach((skin, i) => {
    const back = i < 2;
    const g = (back ? i : i - 2) === 0 ? -0.5 : 0.5;
    const r = makeSpine(rocketData);
    r.skeleton.setSkinByName(skin);
    r.skeleton.setSlotsToSetupPose();
    r.state.setAnimation(0, 'idle', true);
    r.angle = (back ? 10 : 6) * g;
    r.position.set(
      crate.x + g * crate.w * (back ? 0.34 : 0.15),
      crate.y + (back ? -0.13 : 0.04) * crate.w,
    );
    r.scale.set(back ? 1.05 : 0.92);
    rocketLayer.addChild(r);
    spines.push(r);
  });
  app.stage.addChild(rocketLayer, rocketClip);

  // tutorial hand, tapping
  const handData = await loadSkeleton({
    jsonUrl: handJsonUrl, atlasText: handAtlasText, pageUrl: handPageUrl,
  });
  const hand = makeSpine(handData);
  hand.state.setAnimation(0, 'tap', true);
  add(hand, 600, 1160, 0.25);

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
