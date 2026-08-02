import { Application, Graphics, Texture, TilingSprite } from 'pixi.js';
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
    backgroundColor: 0x16b3e4,
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

  // full-screen water floor — the colourized blue tile covers the whole stage,
  // no separate pool area or pink surround
  const poolImg = new Image();
  poolImg.src = poolTileUrl;
  await poolImg.decode();
  const water = new TilingSprite({
    texture: Texture.from(poolImg),
    width: DESIGN_W,
    height: DESIGN_H,
  });
  water.tileScale.set(1.3); // tile pitch ≈ the example's 1.35 world units at our ppu
  app.stage.addChild(water);

  // bathtub rim around the playfield — same recipe the reference playable draws
  // procedurally (no tub texture exists in the asset pack): a rounded rect stroked
  // dark #2f9fd4 with a lighter #aff0ff band on top, leaving thin dark edges
  const tub = { x: 10, y: 10, w: DESIGN_W - 20, h: DESIGN_H - 20, r: 50 };
  const tubFrame = new Graphics()
    .roundRect(tub.x, tub.y, tub.w, tub.h, tub.r)
    .stroke({ width: 20, color: 0x2f9fd4 })
    .roundRect(tub.x, tub.y, tub.w, tub.h, tub.r)
    .stroke({ width: 11, color: 0xaff0ff });
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
  const stock = ['red', 'green', 'purple', 'yellow'] as const;
  stock.forEach((skin, i) => {
    const back = i < 2;
    const g = (back ? i : i - 2) === 0 ? -0.5 : 0.5;
    const r = makeSpine(rocketData);
    r.skeleton.setSkinByName(skin);
    r.skeleton.setSlotsToSetupPose();
    r.state.setAnimation(0, 'idle', true);
    r.angle = (back ? 8 : 4) * g;
    add(
      r,
      crate.x + g * crate.w * (back ? 0.32 : 0.14),
      crate.y + (back ? -0.27 : -0.045) * crate.w,
      back ? 1.0 : 0.88,
    );
  });

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
