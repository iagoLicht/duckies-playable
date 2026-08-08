// Shoot the playable across the device matrix and MEASURE it, rather than
// trusting a look at the picture.
//
//   node tests/responsive.mjs                       -> dev server on :5173
//   node tests/responsive.mjs http://localhost:5183
//   node tests/responsive.mjs dist/duckies-pop-playable.html
//   node tests/responsive.mjs --shots                -> also write the PNGs
//
// Safe-area insets cannot be emulated: no desktop browser and no Playwright
// device profile reports one, so `env(safe-area-inset-*)` is 0 everywhere a CI
// can reach. src/game/layout.ts therefore reads
// `var(--dp-safe-top, env(safe-area-inset-top, 0px))`, and this harness sets
// those variables before boot. Everything downstream — the fit, the bleed, the
// HUD's clearance — is then the exact code a real iPhone runs.
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const shots = args.includes('--shots');
const target = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5173';
const url = target.startsWith('http') ? target : pathToFileURL(path.resolve(target)).href;

const NONE = { top: 0, right: 0, bottom: 0, left: 0 };
/** the reported CSS viewport and the real insets, per device */
const DEVICES = [
  { name: 'iphone-se', w: 375, h: 667, insets: NONE },
  { name: 'iphone-14-notch', w: 390, h: 844, insets: { top: 47, right: 0, bottom: 34, left: 0 } },
  { name: 'iphone-15-pro-island', w: 393, h: 852, insets: { top: 59, right: 0, bottom: 34, left: 0 } },
  { name: 'iphone-15-max-island', w: 430, h: 932, insets: { top: 59, right: 0, bottom: 34, left: 0 } },
  { name: 'iphone-15-landscape', w: 852, h: 393, insets: { top: 0, right: 59, bottom: 21, left: 59 } },
  { name: 'pixel-7-cutout', w: 412, h: 915, insets: { top: 24, right: 0, bottom: 24, left: 0 } },
  { name: 'galaxy-s8-tall', w: 360, h: 740, insets: NONE },
  { name: 'android-small', w: 320, h: 480, insets: NONE },
  { name: 'ipad-portrait', w: 820, h: 1180, insets: { top: 24, right: 0, bottom: 20, left: 0 } },
  { name: 'ipad-landscape', w: 1180, h: 820, insets: { top: 24, right: 0, bottom: 20, left: 0 } },
  { name: 'desktop', w: 1440, h: 900, insets: NONE },
  { name: 'slot-square', w: 600, h: 620, insets: NONE },
  { name: 'slot-wide', w: 1920, h: 480, insets: NONE },
  // Fractional devicePixelRatio — Windows at 150% scaling, Chrome at 150% zoom,
  // and a large slice of budget Android. Pixi rounds its buffer to whole device
  // pixels here, so the rendered area and the element disagree by a fraction of
  // a pixel and anything drawn to the exact requested size leaves a hairline of
  // the clear colour down an edge. These three sizes are the ones that showed
  // it; the edge scan below is what catches it.
  { name: 'island-dpr1.5', w: 393, h: 852, dsf: 1.5, insets: { top: 59, right: 0, bottom: 34, left: 0 } },
  { name: 'notch-dpr1.5', w: 377, h: 813, dsf: 1.5, insets: { top: 47, right: 0, bottom: 34, left: 0 } },
  { name: 'pixel-dpr1.5', w: 412, h: 915, dsf: 1.5, insets: { top: 24, right: 0, bottom: 24, left: 0 } },
  { name: 'desktop-dpr1.25', w: 1440, h: 900, dsf: 1.25, insets: NONE },
];

/** the renderer's clear colour — what shows through if a fill falls short */
const CLEAR = [0xf8, 0xdf, 0xe4];

/**
 * Scan the outermost row/column of a screenshot for a FLAT line of the clear
 * colour. That is the signature of a full-screen fill that stopped a fraction
 * of a pixel short: a perfectly uniform line (standard deviation 0) in exactly
 * the colour nothing is supposed to be painting. Real content — mosaic wall,
 * tub rim, a scrim over either — always varies or is a different colour.
 */
const edgeScan = async (png, tag) => {
  const img = sharp(png);
  const { width, height } = await img.metadata();
  const strips = [
    ['top', { left: 0, top: 0, width, height: 1 }],
    ['bottom', { left: 0, top: height - 1, width, height: 1 }],
    ['left', { left: 0, top: 0, width: 1, height }],
    ['right', { left: width - 1, top: 0, width: 1, height }],
  ];
  for (const [side, rect] of strips) {
    const { data, info } = await sharp(png).extract(rect).raw()
      .toBuffer({ resolveWithObject: true });
    const n = info.width * info.height;
    let flat = true;
    let clear = true;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) {
        if (data[i * info.channels + c] !== data[c]) flat = false;
        if (Math.abs(data[i * info.channels + c] - CLEAR[c]) > 2) clear = false;
      }
      if (!flat && !clear) break;
    }
    if (flat && clear) {
      fail(`[${tag}] ${side} edge is a flat line of the clear colour ` +
        `(${data[0]},${data[1]},${data[2]}) — a full-screen fill is falling short`);
    }
  }
};

if (shots) fs.mkdirSync('shots/responsive', { recursive: true });
const browser = await chromium.launch();
let failed = false;
const fail = (msg) => { failed = true; console.error(`  FAIL ${msg}`); };

/**
 * What the page can tell us about where things actually ended up.
 *
 * Measured off the live scene graph, not off the pixels: `getBounds()` is in
 * world space, and world space is CSS px, so the HUD's rectangle here is the
 * one a thumb hits. `__scene` is DEV-only, so against the built file only the
 * canvas geometry is available — reported as `sceneless` rather than silently
 * passing a check that never ran.
 */
const probe = () => {
  const rect = document.querySelector('canvas').getBoundingClientRect();
  const canvas = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  const s = window.__scene;
  if (!s) return { canvas, sceneless: true };
  const app = s.app;
  const b = (node) => {
    const r = node.getBounds();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  // stage children: [root]; root children: [backdrop, board, overlay]
  const root = app.stage.children[0];
  const [backdrop, , overlay] = root.children;
  return {
    canvas,
    resolution: app.renderer.resolution,
    root: { scale: root.scale.x, scaleY: root.scale.y, x: root.position.x, y: root.position.y },
    backdrop: b(backdrop),
    hud: b(s.hud),
    overlayChildren: overlay.children.length,
  };
};

/** a page at this device's size, with its insets injected before boot */
const newPage = async (d) => {
  const page = await browser.newPage({
    viewport: { width: d.w, height: d.h },
    deviceScaleFactor: d.dsf ?? 1,
  });
  page.on('console', (m) => {
    if (m.type() === 'error') fail(`[${d.name}] console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => fail(`[${d.name}] pageerror: ${e.message}`));
  // An init script runs before the document element exists, so the variables go
  // on the moment there is something to put them on — and before the module
  // script boots, which is what actually matters.
  await page.addInitScript((ins) => {
    const apply = () => {
      const r = document.documentElement;
      if (!r) return false;
      r.style.setProperty('--dp-safe-top', `${ins.top}px`);
      r.style.setProperty('--dp-safe-right', `${ins.right}px`);
      r.style.setProperty('--dp-safe-bottom', `${ins.bottom}px`);
      r.style.setProperty('--dp-safe-left', `${ins.left}px`);
      return true;
    };
    if (!apply()) {
      document.addEventListener('readystatechange', apply);
      document.addEventListener('DOMContentLoaded', apply, { once: true });
    }
  }, d.insets);
  return page;
};

/**
 * Re-apply the inset variables AFTER boot, and make the page relayout.
 *
 * The built file is a gzip self-extractor: `scripts/pack.mjs` ends it with
 * `document.open(); document.write(...); document.close()`, and document.open()
 * throws away the document element the init script decorated along with every
 * listener on it. So against `dist/` the init script's variables are gone
 * before layout.ts ever reads the probe, and the whole device matrix would run
 * with silently-zero insets and pass — testing nothing. Setting them again once
 * the scene is up is the same code path either way, and it means the numbers
 * below are real for the artefact that actually ships.
 */
const applyInsets = async (page, insets) => {
  await page.evaluate((ins) => {
    const r = document.documentElement;
    r.style.setProperty('--dp-safe-top', `${ins.top}px`);
    r.style.setProperty('--dp-safe-right', `${ins.right}px`);
    r.style.setProperty('--dp-safe-bottom', `${ins.bottom}px`);
    r.style.setProperty('--dp-safe-left', `${ins.left}px`);
    window.dispatchEvent(new Event('resize'));
  }, insets);
  await page.waitForTimeout(150);
  // and prove they landed, rather than assuming
  const seen = await page.evaluate(() => {
    const el = document.getElementById('dp-safe-probe');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      top: parseFloat(cs.paddingTop), right: parseFloat(cs.paddingRight),
      bottom: parseFloat(cs.paddingBottom), left: parseFloat(cs.paddingLeft),
    };
  });
  return seen;
};

const ready = async (page, name) => {
  try {
    await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 20000 });
    return true;
  } catch {
    fail(`[${name}] __sceneReady never set`);
    await page.close();
    return false;
  }
};

try {
  console.log('geometry, HUD and backdrop');
  for (const d of DEVICES) {
    const page = await newPage(d);
    await page.goto(url);
    if (!await ready(page, d.name)) continue;
    const seen = await applyInsets(page, d.insets);
    if (!seen) {
      fail(`[${d.name}] no safe-area probe in the page — insets are not being read at all`);
    } else if (seen.top !== d.insets.top || seen.right !== d.insets.right ||
               seen.bottom !== d.insets.bottom || seen.left !== d.insets.left) {
      fail(`[${d.name}] probe read ${JSON.stringify(seen)}, injected ${JSON.stringify(d.insets)}`);
    }
    await page.waitForTimeout(400);

    const m = await page.evaluate(probe);
    const safeL = d.insets.left, safeT = d.insets.top;
    const safeR = d.w - d.insets.right, safeB = d.h - d.insets.bottom;
    const eps = 0.75; // sub-pixel rounding in getBoundingClientRect

    // 1. the canvas is the whole viewport
    if (Math.abs(m.canvas.width - d.w) > eps || Math.abs(m.canvas.height - d.h) > eps) {
      fail(`[${d.name}] canvas ${m.canvas.width}x${m.canvas.height} != viewport ${d.w}x${d.h}`);
    }
    if (Math.abs(m.canvas.x) > eps || Math.abs(m.canvas.y) > eps) {
      fail(`[${d.name}] canvas offset ${m.canvas.x},${m.canvas.y} — letterboxed, not full-bleed`);
    }
    if (m.sceneless) {
      // No scene handle in the built file — but the PIXELS are still the ship-
      // ping pixels, and the edge scan is a real check on them.
      const png = await page.screenshot();
      await edgeScan(png, d.name);
      if (shots) fs.writeFileSync(`shots/responsive/build-${d.name}.png`, png);
      // the probe reading is the ONLY inset evidence available here, so print
      // it: it is what proves the built file honours the insets at all
      console.log(`${d.name.padEnd(22)} ${d.w}x${d.h}  canvas + edges OK, ` +
        `probe read insets ${seen ? `${seen.top}/${seen.right}/${seen.bottom}/${seen.left}` : 'NONE'} ` +
        `(built file: no __scene to measure)`);
      await page.close();
      continue;
    }
    // 2. uniform scale
    if (Math.abs(m.root.scale - m.root.scaleY) > 1e-9) {
      fail(`[${d.name}] non-uniform scale ${m.root.scale} / ${m.root.scaleY}`);
    }
    // 3. the board is inside the safe area (design px -> screen px via root)
    const board = {
      l: m.root.x, t: m.root.y,
      r: m.root.x + 720 * m.root.scale, b: m.root.y + 1280 * m.root.scale,
    };
    if (board.l < safeL - eps || board.t < safeT - eps || board.r > safeR + eps || board.b > safeB + eps) {
      fail(`[${d.name}] board ${JSON.stringify(board)} escapes safe area ` +
        `${safeL},${safeT},${safeR},${safeB}`);
    }
    // 4. THE HUD — measured, not assumed. Its real world-space rectangle, the
    //    one a thumb hits, against the rectangle the OS has left us.
    const h = m.hud;
    if (h.x < safeL - eps || h.y < safeT - eps ||
        h.x + h.width > safeR + eps || h.y + h.height > safeB + eps) {
      fail(`[${d.name}] HUD ${JSON.stringify(h)} overlaps the safe area ` +
        `${safeL},${safeT},${safeR},${safeB}`);
    }
    // 5. the backdrop covers every pixel of the glass
    const bd = m.backdrop;
    if (bd.x > eps || bd.y > eps || bd.x + bd.width < d.w - eps || bd.y + bd.height < d.h - eps) {
      fail(`[${d.name}] backdrop ${JSON.stringify(bd)} does not cover ${d.w}x${d.h}`);
    }

    console.log(
      `${d.name.padEnd(22)} ${String(d.w).padStart(4)}x${String(d.h).padEnd(4)} ` +
      `scale ${m.root.scale.toFixed(3)}  origin ${m.root.x.toFixed(1)},${m.root.y.toFixed(1)}  ` +
      `HUD top ${h.y.toFixed(1)} (safe top ${safeT}, clears by ${(h.y - safeT).toFixed(1)}px)`,
    );

    // and the pixels themselves: no flat hairline of the clear colour anywhere
    // along the border, with the board up and again under the scrim, which is
    // where a fractional-dpr shortfall goes from invisible to a bright line
    const png = await page.screenshot();
    await edgeScan(png, d.name);
    if (shots) {
      const tag = url.startsWith('file') ? 'build' : 'dev';
      fs.writeFileSync(`shots/responsive/${tag}-${d.name}.png`, png);
    }
    await page.close();
  }

  // ── the tint, on three aspects and across a rotation ─────────────────────
  // The end card's scrim is the only full-screen overlay in the build, and the
  // thing that can go wrong with it is specific: drawn to the board's 720x1280
  // it dims the board and leaves the wall around it bright. So the check is
  // coverage of the CANVAS, before and after the device is turned over with the
  // card already up — a card that was correct when it appeared and wrong after
  // a rotation is the same bug arriving late.
  console.log('\ntint overlay (end card scrim)');
  const TINT_CASES = ['iphone-15-pro-island', 'ipad-portrait', 'slot-wide', 'island-dpr1.5'];
  for (const d of DEVICES.filter((x) => TINT_CASES.includes(x.name))) {
    const page = await newPage(d);
    await page.goto(`${url}${url.includes('?') ? '&' : '?'}level=10&card=lose`);
    if (!await ready(page, d.name)) continue;
    await applyInsets(page, d.insets);
    await page.waitForTimeout(1400); // the card's entrance
    const scrimOf = () => {
      const s = window.__scene;
      if (!s) return null;
      const overlay = s.app.stage.children[0].children[2];
      const card = overlay.children[overlay.children.length - 1];
      const r = card.children[0].getBounds();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const covers = (sc, w, h) =>
      sc && sc.x <= 1 && sc.y <= 1 && sc.x + sc.width >= w - 1 && sc.y + sc.height >= h - 1;

    const before = await page.evaluate(scrimOf);
    if (before === null) {
      console.log(`${d.name.padEnd(22)} built file: no __scene to measure`);
      await page.close();
      continue;
    }
    if (!covers(before, d.w, d.h)) fail(`[${d.name}] scrim ${JSON.stringify(before)} leaves ${d.w}x${d.h} uncovered`);
    const cardPng = await page.screenshot();
    await edgeScan(cardPng, `${d.name} under the scrim`);
    if (shots) fs.writeFileSync(`shots/responsive/card-${d.name}.png`, cardPng);

    await page.setViewportSize({ width: d.h, height: d.w });
    await page.waitForTimeout(400);
    const after = await page.evaluate(scrimOf);
    if (!covers(after, d.h, d.w)) fail(`[${d.name}] after rotation scrim ${JSON.stringify(after)} leaves ${d.h}x${d.w} uncovered`);
    console.log(`${d.name.padEnd(22)} ${d.w}x${d.h} covered, ${d.h}x${d.w} covered after rotation`);
    await page.close();
  }

  // ── input, which is the thing a scaled board can silently break ──────────
  // Every coordinate the game thinks in is a design coordinate; every
  // coordinate a thumb arrives in is a screen one. This drags a real duck by
  // screen pixels and asks the SIM whether it moved, which is the only version
  // of that question worth asking.
  console.log('\ninput mapping (drag a duck by screen pixels)');
  for (const d of DEVICES.filter((x) => ['iphone-15-pro-island', 'ipad-portrait', 'slot-wide'].includes(x.name))) {
    const page = await newPage(d);
    await page.goto(`${url}${url.includes('?') ? '&' : '?'}level=1`);
    if (!await ready(page, d.name)) continue;
    await applyInsets(page, d.insets);
    await page.waitForTimeout(500);
    if (await page.evaluate(() => !window.__scene)) {
      console.log(`${d.name.padEnd(22)} built file: no __scene to drive`);
      await page.close();
      continue;
    }
    // rotate first, so this covers the re-fit path as well as the initial one
    await page.setViewportSize({ width: d.h, height: d.w });
    await page.waitForTimeout(400);

    const spot = await page.evaluate(() => {
      const s = window.__scene;
      const root = s.app.stage.children[0];
      const [a, b] = s.director.world.ducks;
      return {
        id: a.id,
        x: root.position.x + a.x * root.scale.x,
        y: root.position.y + a.y * root.scale.y,
        // pull away from a neighbour, so the shot is aimed back at it
        dx: root.position.x + (a.x - (b.x - a.x)) * root.scale.x,
        dy: root.position.y + (a.y - (b.y - a.y)) * root.scale.y,
      };
    });
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    await page.mouse.move(spot.dx, spot.dy, { steps: 12 });
    await page.waitForTimeout(120);
    const grabbed = await page.evaluate(() => window.__scene.director.slingshot.pull?.duck.id ?? null);
    await page.mouse.up();
    await page.waitForTimeout(250);
    const speed = await page.evaluate((id) => {
      const k = window.__scene.director.world.ducks.find((x) => x.id === id);
      return k ? Math.hypot(k.vx, k.vy) : -1;
    }, spot.id);
    if (grabbed !== spot.id || !(speed > 0)) {
      fail(`[${d.name}] rotated, tap at ${spot.x.toFixed(0)},${spot.y.toFixed(0)} grabbed ${grabbed} ` +
        `(wanted ${spot.id}), launch speed ${speed.toFixed(0)}`);
    } else {
      console.log(`${d.name.padEnd(22)} rotated to ${d.h}x${d.w}: grabbed duck ${grabbed}, ` +
        `launched at ${speed.toFixed(0)}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(failed ? '\nRESPONSIVE CHECKS FAILED' : '\nall responsive checks passed');
process.exitCode = failed ? 1 : 0;
