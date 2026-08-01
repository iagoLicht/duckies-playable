import { Application, Sprite } from 'pixi.js';
import type { Spine } from '@esotericsoftware/spine-pixi-v8';
import { loadSkeleton, makeSpine } from './engine/spineLoader';

import duckySkelUrl from './assets/entities/ducky/ducky.skel';
import duckyAtlasText from './assets/entities/ducky/ducky.atlas?raw';
import duckyPageUrl from './assets/entities/ducky/ducky.webp';
import barrelJsonUrl from './assets/entities/barrel/barrel.json?url';
import barrelAtlasText from './assets/entities/barrel/barrel.atlas?raw';
import barrelPageUrl from './assets/entities/barrel/barrel.webp';
import fwBaseSkelUrl from './assets/entities/firework-base/firework-base.skel';
import fwBaseAtlasText from './assets/entities/firework-base/firework-base.atlas?raw';
import fwBasePageUrl from './assets/entities/firework-base/firework-base.webp';
import fwRocketSkelUrl from './assets/entities/firework-rocket/firework-rocket.skel';
import fwRocketAtlasText from './assets/entities/firework-rocket/firework-rocket.atlas?raw';
import fwRocketPageUrl from './assets/entities/firework-rocket/firework-rocket.webp';
import handJsonUrl from './assets/entities/tutorial-hand/tutorial-hand.json?url';
import handAtlasText from './assets/entities/tutorial-hand/tutorial-hand.atlas?raw';
import handPageUrl from './assets/entities/tutorial-hand/tutorial-hand.webp';
import bgUrl from './assets/theme/in-game-bg.webp';

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

  // background, cover-fit
  const bg = Sprite.from(await (async () => {
    const img = new Image();
    img.src = bgUrl;
    await img.decode();
    return img;
  })());
  const cover = Math.max(DESIGN_W / bg.texture.width, DESIGN_H / bg.texture.height);
  bg.scale.set(cover);
  bg.anchor.set(0.5);
  bg.position.set(DESIGN_W / 2, DESIGN_H / 2);
  app.stage.addChild(bg);

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

  // barrel (JSON rig) at three damage stages
  const barrelData = await loadSkeleton({
    jsonUrl: barrelJsonUrl, atlasText: barrelAtlasText, pageUrl: barrelPageUrl,
  });
  (['idle', 'hit2', 'hit5'] as const).forEach((anim, i) => {
    const b = makeSpine(barrelData);
    b.state.setAnimation(0, anim, false);
    add(b, 150 + i * 210, 700, 0.9);
  });

  // firework crate + one rocket per colour skin
  const fwBaseData = await loadSkeleton({
    skelUrl: fwBaseSkelUrl, atlasText: fwBaseAtlasText, pageUrl: fwBasePageUrl,
  });
  // No `idle` on this rig, so it stays in setup pose. The DEFAULT skin renders foam
  // only — the crate attachments are present but invisible; the `big` skin is the one
  // that actually shows the crate (skins here are size variants, not colours).
  const fwBase = makeSpine(fwBaseData);
  fwBase.skeleton.setSkinByName('big');
  fwBase.skeleton.setSlotsToSetupPose();
  add(fwBase, 200, 980, 0.8);

  const rocketData = await loadSkeleton({
    skelUrl: fwRocketSkelUrl, atlasText: fwRocketAtlasText, pageUrl: fwRocketPageUrl,
  });
  (['yellow', 'green', 'purple', 'red'] as const).forEach((skin, i) => {
    const r = makeSpine(rocketData);
    r.skeleton.setSkinByName(skin);
    r.skeleton.setSlotsToSetupPose();
    r.state.setAnimation(0, 'idle', true);
    add(r, 420 + i * 70, 980, 0.8);
  });

  // tutorial hand, tapping
  const handData = await loadSkeleton({
    jsonUrl: handJsonUrl, atlasText: handAtlasText, pageUrl: handPageUrl,
  });
  const hand = makeSpine(handData);
  hand.state.setAnimation(0, 'tap', true);
  add(hand, 360, 1150, 0.25);

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
