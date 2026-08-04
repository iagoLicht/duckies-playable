import { Application, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
// static (not dynamic) on purpose: spine-pixi-v8 registers its render pipe as a
// pixi extension at module load, which must happen BEFORE app.init() collects
// pipes — a dynamic import after init leaves renderPipes['spine'] undefined in
// dev (the single-file build masked this by evaluating everything up front)
import { GameScene } from './game/scene';

import wallTileUrl from './assets/theme/bath-wall-tile.webp';
import poolTileUrl from './assets/theme/bath-pool-blue.webp';
import tipSideUrl from './assets/entities/wall-bouncers/BouncyWall-small-tip-side-outlined.webp';

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
  // The ring is built from the EXACT frame centerline geometry, offset along
  // true per-point normals — parametric insetting drifts off-parallel at the
  // shoulder curves, which is what caused hairline gaps against the frame.
  const base = tubRingPoints(0);
  const cx = (tub.l + tub.r) / 2, cy = (tub.t + tub.b) / 2;
  const normals = base.map((p, i) => {
    const prev = base[(i + base.length - 1) % base.length] ?? p;
    const next = base[(i + 1) % base.length] ?? p;
    let nx = -(next.y - prev.y), ny = next.x - prev.x;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    if (nx * (cx - p.x) + ny * (cy - p.y) < 0) { nx = -nx; ny = -ny; }
    return { nx, ny };
  });
  const dists: number[] = [];
  {
    let dist = 0;
    let prev = base[0] ?? { x: 0, y: 0 };
    for (const p of base) {
      dist += Math.hypot(p.x - prev.x, p.y - prev.y);
      prev = p;
      dists.push(dist);
    }
  }
  // gentle large-scale undulation (wavelengths ~200-1200px) — the entity bases
  // have smooth blobby edges, not high-frequency wiggle
  const wob = (dist: number): number =>
    2.6 * (Math.sin(dist * 0.012) * 0.8 + Math.sin(dist * 0.031 + 2.1) * 0.5 + Math.sin(dist * 0.0052 + 0.7) * 0.6);
  const ringLoop = (d: (i: number) => number): Array<{ x: number; y: number }> =>
    base.map((p, i) => {
      const n = normals[i] ?? { nx: 0, ny: 0 };
      return { x: p.x + n.nx * d(i), y: p.y + n.ny * d(i) };
    });
  // soft feathered shadow (like the blurred shadow pieces in the entity sheets):
  // faked with concentric strokes at falling widths / rising alpha
  const shadowPts = ringLoop((i) => 25 + wob(dists[i] ?? 0)).map((p) => ({ x: p.x, y: p.y + 3 }));
  const ringShadow = new Graphics();
  for (const [w, a] of [[14, 0.07], [10, 0.1], [6, 0.14]] as const) {
    ringShadow.poly(shadowPts).stroke({ width: w, color: 0x2a6d92, alpha: a, join: 'round', cap: 'round' });
  }
  // two overlapping strokes: a base anchored under the frame's inner edge (can
  // never gap — same geometry, true-normal offset) plus a wobbled stroke giving
  // the organic inner edge; their union reads as one hand-drawn band
  const ringWhite = new Graphics()
    .poly(ringLoop(() => 15.5))
    .stroke({ width: 7, color: 0xffffff, join: 'round', cap: 'round' })
    .poly(ringLoop((i) => 19 + Math.max(-2.5, Math.min(2.5, wob(dists[i] ?? 0)))))
    .stroke({ width: 7, color: 0xffffff, join: 'round', cap: 'round' });

  // triangle bumpers load before the ring is layered: they sit BETWEEN the ring
  // shadow and the ring white line, so the white line paints over the seam and
  // flows continuously into the bumper's baked outline
  const loadTex = async (url: string): Promise<Texture> => {
    const img = new Image();
    img.src = url;
    await img.decode();
    return Texture.from(img);
  };
  const tipTex = await loadTex(tipSideUrl);
  const triLeft = new Sprite(tipTex);
  triLeft.anchor.set(125 / 164, 0.5);
  triLeft.scale.set(-1, 1); // art points left; mirror so the tip points into the field
  triLeft.position.set(tub.l + 24, 950);
  const triRight = new Sprite(tipTex);
  triRight.anchor.set(125 / 164, 0.5);
  triRight.position.set(DESIGN_W - (tub.l + 24), 950);
  app.stage.addChild(ringShadow, triLeft, triRight, ringWhite);

  // rim band: navy outline sandwich, near-white band, cool shadow along the
  // inner edge — colours matched to the gameplay reference
  const tubFrame = new Graphics();
  traceTub(tubFrame, 0).stroke({ width: 30, color: 0x1a2430 });
  traceTub(tubFrame, 0).stroke({ width: 24, color: 0xa9c6cc });
  traceTub(tubFrame, -2).stroke({ width: 17, color: 0xe4eef1 });
  app.stage.addChild(tubFrame);

  // ── the live game: sim-driven entities, input, fx ────────────────────────
  // ?level=N (1-based) jumps straight to a level — for playtesting and for the
  // screenshot harness, which needs to reach level 7 without playing six levels.
  // DEV only: `import.meta.env.DEV` is statically false in the build, so the
  // shipped ad always opens on level 1 and cannot be deep-linked past it.
  let startLevel = 0;
  if (import.meta.env.DEV) {
    const wanted = Number(new URLSearchParams(location.search).get('level'));
    if (Number.isFinite(wanted) && wanted >= 1) startLevel = Math.floor(wanted) - 1;
  }
  const scene = new GameScene(app, 20260802, startLevel);
  await scene.init();

  // deterministic readiness signal for the screenshot harness
  (window as unknown as { __sceneReady?: boolean }).__sceneReady = true;
  // dev-only handle so capture harnesses can read exact sim state (fuses, match
  // flags) instead of guessing from pixels. `import.meta.env.DEV` is statically
  // false in the build, so this whole block is dropped from the shipped file.
  if (import.meta.env.DEV) {
    (window as unknown as { __scene?: GameScene }).__scene = scene;
  }
  // The sound layer has no pixels, so the only way to verify it in a browser is
  // to read its own counters. DEV-only, like __scene: statically dropped from the
  // shipped file. See shots/audio-probe.mjs.
  if (import.meta.env.DEV) {
    (window as unknown as { __audio?: typeof scene.audio }).__audio = scene.audio;
  }
}

boot().catch((e: unknown) => {
  // surface boot failures — a swallowed rejection here is a blank screen with no clue,
  // and console.error is exactly what the screenshot harness's gate listens for
  console.error('boot failed', e);
});
