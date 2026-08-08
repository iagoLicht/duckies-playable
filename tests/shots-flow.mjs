// Screenshot the full ad flow while an auto-player plays it: board states,
// crate damage stages, the win card, the L10 board, the terminal card. Used to
// eyeball view-layer changes (rig pooling, prepared cards, sleeping crates)
// against reference behavior. Fails on console errors like tests/shot.mjs.
//
//   node tests/shots-flow.mjs [url] --out=DIR
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flagOf = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const target = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5199';
const outDir = flagOf('out', path.join('tests', 'perf-out', 'flow-shots'));
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()} @ ${m.location().url}`);
});
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
});

await page.goto(`${target}/?level=9`);
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 20000 });
await page.mouse.move(8, 8); await page.mouse.down(); await page.mouse.up();

await page.evaluate((seed) => {
  const s = window.__scene;
  let a = seed >>> 0;
  const rng = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const st = { holdUntil: 0, nextAt: performance.now() + 400 };
  const PULL = 140;
  const aimFrom = (duck, ang) =>
    s.director.slingshot.move(duck.x - Math.cos(ang) * PULL, duck.y - Math.sin(ang) * PULL);
  const tick = (now) => {
    const dir = s.director;
    const sl = dir.slingshot;
    if (sl.aiming) {
      if (now >= st.holdUntil) { if (!sl.end()) sl.cancel(); st.nextAt = now + 500; }
    } else if (dir.readyForInput && now >= st.nextAt && !dir.won && !dir.failed) {
      const ducks = dir.world.ducks.filter((d) => !d.live && !d.popping && !d.matched);
      if (ducks.length >= 2) {
        const duck = ducks[Math.floor(rng() * ducks.length)];
        const others = ducks.filter((d) => d !== duck);
        const t2 = others[Math.floor(rng() * others.length)];
        if (sl.begin(duck.x, duck.y)) {
          const base = Math.atan2(t2.y - duck.y, t2.x - duck.x);
          aimFrom(duck, base);
          let k = 1;
          while (sl.preview()?.hitKind !== 'duck' && k <= 40) {
            aimFrom(duck, base + Math.ceil(k / 2) * (Math.PI / 60) * (k % 2 ? 1 : -1));
            k++;
          }
          if (sl.preview()?.hitKind !== 'duck') { sl.cancel(); st.nextAt = now + 300; }
          else st.holdUntil = now + 350;
        }
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, 20260808);

const snap = async (name) => {
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log('shot', name);
};

const state = () => page.evaluate(() => {
  const s = window.__scene;
  const root = s.app.stage.children[0];
  const overlay = root.children[2];
  const card = overlay.children.find((c) => c.visible);
  const btn = card ? card.children.find((c) => c.cursor === 'pointer') : null;
  return {
    lv: s.director.levelIndex,
    won: s.director.won, failed: s.director.failed,
    barrels: s.director.world.barrels.map((b) => `${b.id}:hp${b.hp}`).join(' '),
    card: !!card,
    clickable: !!btn && btn.eventMode === 'static',
    rootX: root.position.x, rootY: root.position.y, scale: root.scale.x,
  };
});

let last = { lv: 9, card: false };
let shotsAt = 0;
const t0 = Date.now();
while (Date.now() - t0 < 120000) {
  await page.waitForTimeout(500);
  const st = await state();
  const tSec = Math.round((Date.now() - t0) / 1000);
  if (tSec >= shotsAt + 6 && !st.card) {
    shotsAt = tSec;
    await snap(`L${st.lv + 1}-t${String(tSec).padStart(3, '0')}`);
    console.log('  barrels:', st.barrels);
  }
  if (st.card && !last.card) {
    await page.waitForTimeout(1300); // let the entrance land
    await snap(`card-after-L${st.lv + 1}`);
  }
  if (st.card && st.clickable && st.lv === 8) {
    await page.mouse.click(st.rootX + 360 * st.scale, st.rootY + 675 * st.scale);
    await page.waitForTimeout(400);
    await snap('L10-just-loaded');
  } else if (st.card && st.clickable) {
    console.log('terminal card reached; done. won=' + st.won);
    break;
  }
  last = st;
}
await browser.close();

if (errors.length) {
  console.error(`${errors.length} page errors:`);
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log('flow clean, shots in', outDir);
