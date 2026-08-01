# Phase A: Foundation + Spine Rendering Spike — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A repo that builds a single self-contained HTML file rendering all four ducky colour skins, the barrel rig, and the firework crate/rockets via spine-pixi-v8 — proving the entire rendering + asset pipeline before any gameplay is written.

**Architecture:** Vite + TypeScript, PixiJS v8 with `@esotericsoftware/spine-pixi-v8@~4.2` (asset data is Spine 4.2.40). All assets are imported through Vite with `assetsInlineLimit: Infinity` so the production build inlines everything as data URIs; a post-build script gzips the result into a self-extracting wrapper (same technique as Candivore's reference examples). Spine rigs load through a hand-rolled loader (fetch → `SkeletonBinary`/`SkeletonJson` + manual `TextureAtlas` page wiring) because Pixi's `Assets` extension-sniffing does not work on data URIs.

**Tech Stack:** pixi.js ^8.16, @esotericsoftware/spine-pixi-v8 ~4.2.119, vite 6, vite-plugin-singlefile, sharp (webp conversion), subset-font (font subsetting), playwright (screenshot QA).

**Context you need (no other docs required):**
- Asset pack lives at `C:\Users\licht\OneDrive\Desktop\Candivore\Marketing AI Student_Ready\duckies-playable-home-test 3\assets\` — referred to as `$PACK` below.
- The repo lives at `C:\dev\duckies-playable` (deliberately **outside OneDrive**; OneDrive file-locks corrupt `node_modules`).
- The ducky rig's `green`/`purple`/`red` skins colour the *same* atlas regions via per-attachment colours. If spine-pixi-v8 renders them, all four ducks appear in different colours from one 74 KB texture. **That is the spike's pass/fail criterion.**
- Spine version pinning is load-bearing: data is 4.2.40, npm `latest` runtime is 4.3.x and will refuse to parse it. Never `npm i` the spine package without `~4.2`.
- Design canvas is 720×1280 portrait, letterboxed by CSS. Never resize the WebGL canvas after creation (iOS WebKit leak) — fit with CSS only.

---

### Task 1: Repo scaffold + Pixi boot

**Files:**
- Create: `C:\dev\duckies-playable\package.json`
- Create: `C:\dev\duckies-playable\tsconfig.json`
- Create: `C:\dev\duckies-playable\vite.config.ts`
- Create: `C:\dev\duckies-playable\.gitignore`
- Create: `C:\dev\duckies-playable\index.html`
- Create: `C:\dev\duckies-playable\src\main.ts`

- [ ] **Step 1: Create the repo and install dependencies**

```powershell
mkdir C:\dev\duckies-playable; cd C:\dev\duckies-playable
git init -b main
```

Write `package.json`:

```json
{
  "name": "duckies-playable",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build && node scripts/pack.mjs",
    "assets": "node scripts/prepare-assets.mjs",
    "shot": "node tests/shot.mjs"
  },
  "dependencies": {
    "@esotericsoftware/spine-pixi-v8": "~4.2.119",
    "pixi.js": "^8.16.0"
  },
  "devDependencies": {
    "playwright": "^1.60.0",
    "sharp": "^0.34.0",
    "subset-font": "^2.4.0",
    "typescript": "^5.5.0",
    "vite": "^6.0.0",
    "vite-plugin-singlefile": "^2.0.0"
  }
}
```

Then:

```powershell
npm install --no-audit --no-fund
npx playwright install chromium
```

Expected: install succeeds; `npm ls pixi.js @esotericsoftware/spine-pixi-v8` shows pixi 8.16+ and spine 4.2.x (NOT 4.3.x).

- [ ] **Step 2: Write config files**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  // .skel is binary, .atlas is text — both must be importable as assets
  assetsInclude: ['**/*.skel', '**/*.atlas'],
  build: {
    target: 'es2020',
    // inline EVERY imported asset as a data: URI — this is what makes the single file possible
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    chunkSizeWarningLimit: 8192,
  },
  plugins: [viteSingleFile()],
});
```

`.gitignore`:

```
node_modules/
dist/
shots/
```

- [ ] **Step 3: Write the HTML shell and boot code**

`index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover" />
  <title>Duckies Pop</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #f8dfe4; overflow: hidden; }
    #game { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }
    canvas { display: block; }
  </style>
</head>
<body>
  <div id="game"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

`src/main.ts` (boot-only version; Task 3 replaces the stage contents):

```ts
import { Application, Text } from 'pixi.js';

export const DESIGN_W = 720;
export const DESIGN_H = 1280;

/** CSS letterbox fit. The GL canvas is sized ONCE (iOS WebKit leaks on GL resize);
 *  only its CSS size ever changes. */
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
    antialias: false, // MSAA alone halves FPS on mid-range Android
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    roundPixels: true,
  });
  app.ticker.maxFPS = 60; // 120 Hz phones must not run 2× work
  document.getElementById('game')!.appendChild(app.canvas);
  fitCanvas(app);
  window.addEventListener('resize', () => fitCanvas(app));
  window.visualViewport?.addEventListener('resize', () => fitCanvas(app));

  app.stage.addChild(new Text({
    text: 'boot ok',
    style: { fill: 0x2c1e31, fontSize: 48 },
  }));
}

void boot();
```

- [ ] **Step 4: Verify it boots**

```powershell
npm run dev
```

Open `http://localhost:5173` — expected: pink page, "boot ok" text, no console errors. Stop the server.

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "chore: scaffold vite+pixi8+spine-pixi 4.2, CSS-letterboxed 720x1280 boot"
```

---

### Task 2: Asset staging script

Converts/copies exactly the assets the whole project needs from `$PACK` into `src/assets/`.
PNGs → WebP (atlas pages must keep their **exact pixel dimensions** or Spine UVs break — quality-only
re-encode). Fonts → subsetted woff2. Skeletons/audio → copied as-is.

**Files:**
- Create: `C:\dev\duckies-playable\scripts\prepare-assets.mjs`

- [ ] **Step 1: Write the script**

```js
// Stages game assets from the Candivore pack into src/assets/.
// PNG -> WebP at unchanged dimensions (Spine atlas UVs depend on exact pixel size).
// Run: npm run assets
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import subsetFont from 'subset-font';

const PACK = 'C:/Users/licht/OneDrive/Desktop/Candivore/Marketing AI Student_Ready/duckies-playable-home-test 3/assets';
const OUT = 'src/assets';

/** Copied byte-for-byte (skeletons, atlases, audio). */
const COPY = [
  'entities/ducky/ducky.skel', 'entities/ducky/ducky.atlas',
  'entities/barrel/barrel.json', 'entities/barrel/barrel.atlas',
  'entities/firework-base/firework-base.skel', 'entities/firework-base/firework-base.atlas',
  'entities/firework-rocket/firework-rocket.skel', 'entities/firework-rocket/firework-rocket.atlas',
  'entities/tutorial-hand/tutorial-hand.json', 'entities/tutorial-hand/tutorial-hand.atlas',
  'sfx/clips/launch-pull.mp3', 'sfx/clips/launch-release.mp3',
  'sfx/clips/duck-bump.mp3', 'sfx/clips/duck-explode.mp3',
  'sfx/clips/match-collision.mp3', 'sfx/clips/merge-done.mp3',
  'sfx/clips/candy-hit.mp3', 'sfx/clips/candy-smash.mp3',
  'sfx/clips/spawn-sploosh.mp3', 'sfx/clips/win-whoosh.mp3',
  'sfx/clips/ui-click.mp3', 'sfx/clips/merge-swirl.mp3',
];

/** PNG -> WebP, same dimensions. q: quality; width set ONLY for non-atlas standalone art. */
const WEBP = [
  { src: 'entities/ducky/ducky.png', q: 82 },                       // atlas page — quality generous, it's the hero
  { src: 'entities/barrel/barrel.png', q: 80 },                     // atlas page
  { src: 'entities/firework-base/firework-base.png', q: 80 },       // atlas page
  { src: 'entities/firework-rocket/firework-rocket.png', q: 80 },   // atlas page
  { src: 'entities/tutorial-hand/tutorial-hand.png', q: 80 },       // atlas page
  { src: 'theme/in-game-bg.png', q: 60 },                           // full-screen bg, flat art survives low q
  { src: 'icons/goal-Barrel.png', q: 75 },
  { src: 'icons/goal-DuckAll.png', q: 75 },
  { src: 'ui/btn-play-hero.png', q: 75 },
  { src: 'ui/hud-currency-plate.png', q: 75 },
  { src: 'ui/popup-body-tall.png', q: 75 },
  { src: 'icons/ribbon-pink.png', q: 70 },
  { src: 'vfx/impact-star.png', q: 75 },
  { src: 'vfx/dome.png', q: 75 },
  { src: 'vfx/explode-particle.png', q: 80 },
  { src: 'vfx/ptx-stars.png', q: 80 },
  { src: 'vfx/ssa-explosion.png', q: 75 },
  { src: 'vfx/curve.png', q: 75 },
  { src: 'vfx/trail-noise-short.png', q: 75 },
  { src: 'vfx/aim/aim-dot.png', q: 85 },
  { src: 'vfx/aim/aim-fire-arrow.png', q: 85 },
  { src: 'vfx/aim/aim-touch-bg.png', q: 85 },
  { src: 'vfx/aim/aim-touch-front.png', q: 85 },
  { src: 'entities/wall-bouncers/BouncyWall-wall-horizontal.png', q: 80 },
  { src: 'entities/wall-bouncers/BouncyWall-wall-vertical.png', q: 80 },
  { src: 'entities/wall-bouncers/BouncyWall-triangle-top.png', q: 80 },
  { src: 'entities/wall-bouncers/BouncyWall-triangle-bottom.png', q: 80 },
];

/** Fonts -> woff2 subset. Title Case per brand rules, so keep both cases + digits + punctuation. */
const FONT_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 !?.,:/×+-\'"%';
const FONTS = [
  { src: 'fonts/CherryBombOne-Regular.ttf', out: 'fonts/cherry-bomb.woff2' },
  { src: 'fonts/asap-semicondensed-black.ttf', out: 'fonts/asap-black.woff2' },
];

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
let totalIn = 0;
let totalOut = 0;

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

for (const rel of COPY) {
  const src = path.join(PACK, rel);
  const out = path.join(OUT, rel);
  ensureDir(out);
  fs.copyFileSync(src, out);
  const size = fs.statSync(out).size;
  totalIn += size;
  totalOut += size;
  console.log(`copy  ${rel.padEnd(58)} ${kb(size)}`);
}

for (const { src: rel, q } of WEBP) {
  const src = path.join(PACK, rel);
  const out = path.join(OUT, rel.replace(/\.png$/, '.webp'));
  ensureDir(out);
  const inSize = fs.statSync(src).size;
  await sharp(src).webp({ quality: q }).toFile(out);
  const outSize = fs.statSync(out).size;
  totalIn += inSize;
  totalOut += outSize;
  console.log(`webp  ${rel.padEnd(58)} ${kb(inSize)} -> ${kb(outSize)} (q${q})`);
}

for (const { src: rel, out: outRel } of FONTS) {
  const src = path.join(PACK, rel);
  const out = path.join(OUT, outRel);
  ensureDir(out);
  const inBuf = fs.readFileSync(src);
  const outBuf = await subsetFont(inBuf, FONT_CHARS, { targetFormat: 'woff2' });
  fs.writeFileSync(out, outBuf);
  totalIn += inBuf.length;
  totalOut += outBuf.length;
  console.log(`font  ${rel.padEnd(58)} ${kb(inBuf.length)} -> ${kb(outBuf.length)}`);
}

console.log(`\ntotal ${kb(totalIn)} -> ${kb(totalOut)}  (inlined cost ≈ ${kb(totalOut * 1.37)})`);
```

- [ ] **Step 2: Run it and check the output**

```powershell
npm run assets
```

Expected: a size table; total output well under 1.5 MB; `src/assets/entities/ducky/ducky.webp` exists. Spot-check one webp opens in a viewer and has the SAME dimensions as its source png (1716×524 for ducky).

- [ ] **Step 3: Commit**

```powershell
git add -A; git commit -m "feat: asset staging script (webp same-size re-encode, woff2 subsets)"
```

---

### Task 3: Spine loader + the four-skins spike

This is the phase's reason to exist. If this task's screenshot shows four differently-coloured
animated ducks, the riskiest unknown in the whole project is retired.

**Files:**
- Create: `C:\dev\duckies-playable\src\engine\spineLoader.ts`
- Modify: `C:\dev\duckies-playable\src\main.ts` (replace the "boot ok" text with the spike stage)

- [ ] **Step 1: Write the Spine loader**

`src/engine/spineLoader.ts`:

```ts
// Manual Spine loading. Why not Assets.load('x.skel')? In the production build every
// asset is a data: URI, and Pixi's Assets loader sniffs file EXTENSIONS to pick a
// parser — data URIs have none. So: fetch the bytes ourselves, parse with the spine
// runtime directly, and wire the atlas page texture by hand. One code path for dev
// (real URLs) and build (data URIs).
import { Texture } from 'pixi.js';
import {
  AtlasAttachmentLoader,
  SkeletonBinary,
  SkeletonData,
  SkeletonJson,
  Spine,
  SpineTexture,
  TextureAtlas,
} from '@esotericsoftware/spine-pixi-v8';

/** Decode an image URL (path or data URI) into a Pixi texture, reliably. */
async function loadImageTexture(url: string): Promise<Texture> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return Texture.from(img);
}

export interface SpineSource {
  /** .skel binary URL — provide this OR jsonUrl */
  skelUrl?: string;
  /** spine .json URL (barrel, tutorial-hand) */
  jsonUrl?: string;
  /** .atlas file CONTENT (import with ?raw) */
  atlasText: string;
  /** the single atlas page image URL */
  pageUrl: string;
  /** skeleton scale applied at parse time */
  scale?: number;
}

export async function loadSkeleton(src: SpineSource): Promise<SkeletonData> {
  const pageTexture = await loadImageTexture(src.pageUrl);
  const atlas = new TextureAtlas(src.atlasText);
  if (atlas.pages.length !== 1) {
    throw new Error(`expected single-page atlas, got ${atlas.pages.length}`);
  }
  atlas.pages[0]!.setTexture(SpineTexture.from(pageTexture.source));

  const loader = new AtlasAttachmentLoader(atlas);
  if (src.skelUrl) {
    const parser = new SkeletonBinary(loader);
    parser.scale = src.scale ?? 1;
    const buf = await (await fetch(src.skelUrl)).arrayBuffer();
    return parser.readSkeletonData(new Uint8Array(buf));
  }
  const parser = new SkeletonJson(loader);
  parser.scale = src.scale ?? 1;
  return parser.readSkeletonData(await (await fetch(src.jsonUrl!)).text());
}

/** Create a display object for a parsed skeleton. autoUpdate stays OFF — skeletons
 *  are ticked centrally so hidden/pooled rigs cost zero (perf doctrine). */
export function makeSpine(data: SkeletonData): Spine {
  const spine = new Spine({ skeletonData: data });
  spine.autoUpdate = false;
  return spine;
}
```

- [ ] **Step 2: Write the spike stage**

Replace the whole of `src/main.ts` with:

```ts
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
  add(makeSpine(fwBaseData), 200, 980, 0.8);

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
}

void boot();
```

- [ ] **Step 3: Add asset module declarations**

TypeScript doesn't know `.skel`/`.atlas`/`.webp` imports. Create `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
declare module '*.skel' { const url: string; export default url; }
declare module '*.webp' { const url: string; export default url; }
declare module '*.atlas?raw' { const text: string; export default text; }
```

(Vite's own types already cover `?raw` and `?url` generically in recent versions; if `tsc` still
complains about the `?raw` import, keep the explicit declaration above.)

- [ ] **Step 4: Run and inspect**

```powershell
npm run dev
```

Open `http://localhost:5173`. Expected, all at once:
- four ducks in FOUR DIFFERENT COLOURS bobbing out of sync
- three barrels at increasing damage
- crate + four coloured rockets
- hand tapping
- zero console errors

Troubleshooting knowledge (why a failure looks the way it does):
- **All four ducks yellow** → per-attachment skin colours not applied; try `duck.skeleton.setToSetupPose()` before `setSlotsToSetupPose()`; if still broken, spine-pixi version bump within ~4.2.
- **Dark halos around sprites** → premultiplied-alpha mismatch; set `pageTexture.source.alphaMode = 'premultiply-alpha-on-upload'` in the loader (our atlases are exported non-PMA: no `pma:` line in the .atlas files).
- **Blank spine, no error** → texture never attached; check `atlas.pages[0].setTexture(...)` ran before parsing attachments.
- **`Skeleton data version 4.2.40 does not match runtime`-style error** → someone installed spine 4.3; reinstall with `~4.2.119`.

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat: spine loader + spike stage proving 4 ducky colour skins, barrel, fireworks, hand"
```

---

### Task 4: Screenshot harness

Visual correctness has no unit tests; this is its test runner. Headless Chromium also runs
GPU-less (SwiftShader), which is what automated ad reviewers use — the harshest environment.

**Files:**
- Create: `C:\dev\duckies-playable\tests\shot.mjs`

- [ ] **Step 1: Write the harness**

```js
// Screenshot the playable at phone/tablet viewports and relay console errors.
//   node tests/shot.mjs                          -> dev server, default viewport
//   node tests/shot.mjs --all                    -> all three viewports
//   node tests/shot.mjs dist/duckies-pop-playable.html --all   -> built file
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const all = args.includes('--all');
const target = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5173';
const url = target.startsWith('http') ? target : `file://${path.resolve(target)}`;

const VIEWPORTS = all
  ? [[360, 640], [412, 915], [820, 1180]]
  : [[412, 915]];

fs.mkdirSync('shots', { recursive: true });
const browser = await chromium.launch();
let failed = false;

for (const [w, h] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      failed = true;
      console.error(`[console.error @${w}x${h}] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    failed = true;
    console.error(`[pageerror @${w}x${h}] ${err.message}`);
  });
  await page.goto(url);
  await page.waitForTimeout(3500); // let boot + first animations land
  const name = `shots/${url.startsWith('file') ? 'build' : 'dev'}-${w}x${h}.png`;
  await page.screenshot({ path: name });
  console.log(`wrote ${name}`);
  await page.close();
}

await browser.close();
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run it against the dev server and LOOK at the images**

Terminal 1: `npm run dev`. Terminal 2:

```powershell
npm run shot -- --all
```

Expected: exit code 0, three PNGs in `shots/`. **Open all three.** Pass criteria: four distinct
duck colours visible; nothing clipped at 360×640; letterboxing (not stretching) at 820×1180.

- [ ] **Step 3: Commit**

```powershell
git add -A; git commit -m "feat: playwright screenshot harness (3 viewports, console-error gate)"
```

---

### Task 5: Production single-file build + gzip self-extractor

**Files:**
- Create: `C:\dev\duckies-playable\scripts\pack.mjs`

- [ ] **Step 1: Write the packer**

```js
// dist/index.html (everything inlined by vite) -> dist/duckies-pop-playable.html:
// a gzip self-extractor, the same technique as the reference examples (~45% smaller).
// The plain dist/index.html is kept as a no-DecompressionStream fallback deliverable.
import fs from 'node:fs';
import zlib from 'node:zlib';

const src = 'dist/index.html';
const out = 'dist/duckies-pop-playable.html';
const html = fs.readFileSync(src);
const b64 = zlib.gzipSync(html, { level: 9 }).toString('base64');

const wrapper =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">' +
  '<title>Duckies Pop</title><style>html,body{margin:0;height:100%;background:#f8dfe4}</style></head><body>' +
  '<script>(async()=>{const b="' + b64 + '";' +
  'const s=atob(b),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);' +
  'const t=await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip"))).text();' +
  'document.open();document.write(t);document.close();})();</script></body></html>';

fs.writeFileSync(out, wrapper);
const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;
console.log(`${src}: ${mb(html.length)}  ->  ${out}: ${mb(wrapper.length)}`);
const CEILING = 5_000_000; // decimal MB — the number ad networks actually use
if (wrapper.length > CEILING) {
  console.error(`FAIL: over the 5 MB ceiling`);
  process.exit(1);
}
```

- [ ] **Step 2: Build and verify the built file standalone**

```powershell
npm run build
npm run shot -- dist/duckies-pop-playable.html --all
```

Expected: build succeeds, size line prints (expect well under 5 MB), screenshots of the BUILT
file from `file://` show the same spike scene, exit 0. **Open the PNGs** — data-URI loading is
exactly the path that silently breaks.

- [ ] **Step 3: Commit + tag the milestone**

```powershell
git add -A; git commit -m "feat: single-file build + gzip self-extract packer with 5MB gate"
git tag phase-a-spike-pass
```

---

## Exit criteria (all must hold)

1. `shots/build-412x915.png` (from the **built single file**, opened via `file://`) shows four differently coloured animated ducks, three barrel damage stages, the firework crate with four coloured rockets, and the tutorial hand.
2. Zero console errors at all three viewports, dev and built.
3. Built file size printed and under 5 MB (expect ~1.5–2 MB at this stage).

## What Phase B/C/D will cover (planned after the spike passes)

- **B — the simulation:** pure-TS fixed-timestep sim (drag/sling, colour-match explosions, colour-carrying chain blasts, barrel HP, firework stock rules, waves, director/rigging), vitest + the 1,000-run headless win-rate/pacing test. No Pixi imports anywhere in it.
- **C — presentation:** game scene wiring sim→spine, aim UI, HUD counter, juice stack, tutorial hand behaviour, end card + CTA, sfx via WebAudio with lifecycle handling.
- **D — ship:** WebGL-less static fallback, pause/visibility handling, size/QA passes, deliverable docs (concept intro, second-concept brief, iteration idea) and sync back to the Candivore folder.

---

## Self-review (done at write time)

- **Spec coverage:** Phase A's scope is the pipeline + spike only; all gameplay is explicitly deferred to B/C with their requirements listed so nothing silently drops. ✓
- **Placeholder scan:** every code step contains complete, runnable content; no TBDs. ✓
- **Type consistency:** `loadSkeleton`/`makeSpine` signatures match between Task 3 Step 1 and their call sites in Step 2; asset import names match the staging script's output paths (`.webp` extensions after conversion). ✓
- **Known judgment calls encoded:** spine pinned `~4.2.119`; atlas pages re-encoded at identical dimensions; `autoUpdate = false` from day one; CSS-only canvas fit; decimal-MB ceiling.
