// Frame-time + CPU-profile harness for the playable, on an emulated weak phone.
//
//   node tests/perf.mjs [url] --level=9 --throttle=4 --seconds=60 --out=DIR
//
// Drives the dev build (needs window.__scene, so a vite server URL — not dist/)
// with an in-page auto-player that fires legal slingshot shots, while a rAF
// recorder samples frame deltas, action intensity (moving/popping ducks) and
// JS heap. The action window is also CPU-profiled via CDP and the top self-time
// frames are printed, so "which function eats the frame" is measured, not
// guessed. CPU throttling emulates the weak-device budget (README: 60fps on a
// mid-range Android; 4x on a desktop is roughly that class).
//
// Shots go through director.slingshot directly (sim-space coords, same API the
// bot uses) rather than synthetic pointer events: pointer timing depends on
// wall clock, and direct calls keep runs comparable. One real click is sent
// first so the audio unlock + SFX path is live like a real session.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const target = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5199';
const level = Number(flag('level', '9'));            // 1-based, like ?level=
const throttle = Number(flag('throttle', '4'));      // CPU slowdown factor
const seconds = Number(flag('seconds', '60'));       // action window length
const outDir = flag('out', path.join('tests', 'perf-out'));
const headed = args.includes('--headed');
const idle = args.includes('--idle'); // no auto-player: measures the idle-demo loop
const label = flag('label', `L${level}-x${throttle}${idle ? '-idle' : ''}`);

fs.mkdirSync(outDir, { recursive: true });

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
const ms = (v) => `${v.toFixed(1)}ms`;

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
});

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()} @ ${m.location().url}`);
});
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
});
page.on('requestfailed', (r) => errors.push(`request failed: ${r.failure()?.errorText} ${r.url()}`));

const url = target.startsWith('http')
  ? `${target}/?level=${level}`
  : pathToFileURL(path.resolve(target)).href; // built file: ?level= is compiled out anyway
await page.goto(url);
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 20000 });
// Built files ship without __scene (dev-only, by design): those runs record
// frame times only, driven by whatever the ad does on its own (the idle demo),
// with no auto-player, no sim sampling and no card clicking.
const hasScene = await page.evaluate(() => !!window.__scene);
if (!hasScene && !idle) {
  console.error('no __scene hook — the auto-player needs the dev server; use --idle for built files');
  process.exit(1);
}

const glInfo = await page.evaluate(() => {
  const s = window.__scene;
  if (!s) {
    // built file: probe the GPU through a throwaway context instead
    const gl = document.createElement('canvas').getContext('webgl2');
    const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: 'built', resolution: 0, gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a' };
  }
  const gl = s.app.renderer.gl;
  const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: s.app.renderer.name,
    resolution: s.app.renderer.resolution,
    gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a',
  };
});

// Audio unlock with a real gesture in a corner of the wall, before throttling.
await page.mouse.move(8, 8);
await page.mouse.down();
await page.mouse.up();

const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });

// Recorder: frame deltas off rAF (the Pixi ticker rides the same rAF), plus
// per-frame action intensity and heap so spikes can be tied to game state.
await page.evaluate(() => {
  const s = window.__scene;
  const overlay = s ? s.app.stage.children[0].children[2] : null;
  const rec = { dt: [], live: [], pop: [], lv: [], ov: [], heap: [], running: true, prev: performance.now(), n: 0 };
  window.__perfRec = rec;
  const loop = (now) => {
    if (!rec.running) return;
    rec.dt.push(now - rec.prev);
    rec.prev = now;
    if (s) {
      const w = s.director.world;
      let live = 0, pop = 0;
      for (const d of w.ducks) {
        if (d.live) live++;
        if (d.popping || d.matched) pop++;
      }
      rec.live.push(live);
      rec.pop.push(pop);
      rec.lv.push(s.director.levelIndex);
      // prepared (hidden) verdict cards live in the overlay too — only a
      // visible one means the run is sitting on a card
      rec.ov.push(overlay.children.some((c) => c.visible) ? 1 : 0);
    } else {
      rec.live.push(0); rec.pop.push(0); rec.lv.push(0); rec.ov.push(0);
    }
    rec.heap.push(rec.n % 10 === 0 && performance.memory ? performance.memory.usedJSHeapSize : 0);
    rec.n++;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});

// Auto-player: a seeded, simplified port of tests/sim/bot.ts that only calls
// slingshot.* and lets the page's own ticker step the sim. Grabs a resting
// duck, aims at another duck (sweeping ±3° until the guide locks one, exactly
// the red-X dance a player does), holds ~350ms, releases.
if (!idle) await page.evaluate((seed) => {
  const s = window.__scene;
  let a = seed >>> 0;
  const rng = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const st = { holdUntil: 0, nextAt: performance.now() + 500, shots: 0, refused: 0 };
  window.__player = st;
  const PULL = 140;
  const aimFrom = (duck, ang) => {
    s.director.slingshot.move(duck.x - Math.cos(ang) * PULL, duck.y - Math.sin(ang) * PULL);
  };
  const tick = (now) => {
    const dir = s.director;
    const sl = dir.slingshot;
    if (sl.aiming) {
      if (now >= st.holdUntil) {
        if (sl.end()) st.shots++;
        else { st.refused++; sl.cancel(); }
        st.nextAt = now + 400 + rng() * 500;
      }
    } else if (dir.readyForInput && now >= st.nextAt && !dir.won && !dir.failed) {
      const ducks = dir.world.ducks.filter((d) => !d.live && !d.popping && !d.matched);
      if (ducks.length >= 2) {
        const duck = ducks[Math.floor(rng() * ducks.length)];
        const others = ducks.filter((d) => d !== duck);
        const targetDuck = others[Math.floor(rng() * others.length)];
        if (sl.begin(duck.x, duck.y)) {
          const base = Math.atan2(targetDuck.y - duck.y, targetDuck.x - duck.x);
          aimFrom(duck, base);
          let k = 1;
          while (sl.preview()?.hitKind !== 'duck' && k <= 40) {
            const step = Math.ceil(k / 2) * (Math.PI / 60) * (k % 2 ? 1 : -1);
            aimFrom(duck, base + step);
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
}, 1337 + level);

await cdp.send('Profiler.start');

// Wait out the window; on the way, click the beat-one win card's NEXT LEVEL
// button (a real tap at its design spot) so one run covers the whole ad.
// The terminal card's button opens the store — never click that; instead
// linger 3s on it and end the run early.
const t0 = Date.now();
let terminalSince = 0;
while (Date.now() - t0 < seconds * 1000) {
  await page.waitForTimeout(1000);
  if (idle) continue;
  const st = await page.evaluate(() => {
    const s = window.__scene;
    const root = s.app.stage.children[0];
    const overlay = root.children[2];
    const card = overlay.children.find((c) => c.visible);
    const btn = card ? card.children.find((c) => c.cursor === 'pointer') : null;
    return {
      lv: s.director.levelIndex,
      clickable: !!btn && btn.eventMode === 'static',
      rootX: root.position.x, rootY: root.position.y, scale: root.scale.x,
    };
  });
  if (st.clickable) {
    if (st.lv === 8) {
      await page.mouse.click(st.rootX + 360 * st.scale, st.rootY + 675 * st.scale);
      await page.waitForTimeout(300);
    } else {
      terminalSince ||= Date.now();
      if (Date.now() - terminalSince > 3000) break;
    }
  }
}
const { profile } = await cdp.send('Profiler.stop');

const rec = await page.evaluate(() => {
  const r = window.__perfRec;
  r.running = false;
  return { dt: r.dt, live: r.live, pop: r.pop, lv: r.lv, ov: r.ov, heap: r.heap, player: window.__player ?? { shots: 0, refused: 0 } };
});
const endState = await page.evaluate(() => {
  const d = window.__scene?.director;
  if (!d) return { won: false, failed: false, movesLeft: -1, simTime: -1, ducks: -1 };
  return { won: d.won, failed: d.failed, movesLeft: d.movesLeft, simTime: d.world.time, ducks: d.world.ducks.length };
});
await browser.close();

// ---- frame stats ----------------------------------------------------------
const frames = rec.dt
  .map((v, i) => ({ dt: v, live: rec.live[i], pop: rec.pop[i], lv: rec.lv[i], ov: rec.ov[i] }))
  .slice(5); // drop the settle-in frames
const dt = frames.map((f) => f.dt);
const play = frames.filter((f) => !f.ov);
const action = play.filter((f) => f.live >= 1 || f.pop >= 1).map((f) => f.dt);
const heavy = play.filter((f) => f.live >= 3 || f.pop >= 2).map((f) => f.dt);

const stats = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((x, y) => x - y);
  const sum = s.reduce((t, v) => t + v, 0);
  return {
    n: s.length,
    avg: sum / s.length,
    p50: pct(s, 50), p90: pct(s, 90), p95: pct(s, 95), p99: pct(s, 99),
    max: s[s.length - 1],
    over17: (arr.filter((v) => v > 17.5).length / s.length) * 100,
    over34: (arr.filter((v) => v > 34).length / s.length) * 100,
    over50: (arr.filter((v) => v > 50).length / s.length) * 100,
  };
};
const show = (name, st) => {
  if (!st) return console.log(`${name}: no frames`);
  console.log(
    `${name.padEnd(14)} n=${String(st.n).padStart(5)}  avg=${ms(st.avg)}  p50=${ms(st.p50)}  p90=${ms(st.p90)}  p95=${ms(st.p95)}  p99=${ms(st.p99)}  max=${ms(st.max)}  >17.5ms=${st.over17.toFixed(1)}%  >34ms=${st.over34.toFixed(1)}%  >50ms=${st.over50.toFixed(1)}%`,
  );
};

console.log(`\n=== perf ${label} ===`);
console.log(`renderer=${glInfo.renderer} res=${glInfo.resolution} gpu="${glInfo.gpu}"`);
console.log(`throttle=${throttle}x level=${level} window=${seconds}s shots=${rec.player.shots} refused=${rec.player.refused}`);
console.log(`end: won=${endState.won} failed=${endState.failed} movesLeft=${endState.movesLeft} simTime=${endState.simTime.toFixed(1)}s ducks=${endState.ducks}`);
show('all frames', stats(dt));
for (const L of [...new Set(frames.map((f) => f.lv))]) {
  show(`L${L + 1} play`, stats(play.filter((f) => f.lv === L).map((f) => f.dt)));
}
show('card frames', stats(frames.filter((f) => f.ov).map((f) => f.dt)));
show('action frames', stats(action));
show('heavy frames', stats(heavy));

const heap = rec.heap.filter(Boolean);
if (heap.length) {
  const mb = (v) => (v / 1048576).toFixed(1);
  console.log(`heap: start=${mb(heap[0])}MB end=${mb(heap[heap.length - 1])}MB min=${mb(Math.min(...heap))}MB max=${mb(Math.max(...heap))}MB`);
}

// ---- profile summary ------------------------------------------------------
const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
const selfMicros = new Map();
const total = profile.timeDeltas.reduce((t, v) => t + v, 0);
profile.samples.forEach((id, i) => {
  selfMicros.set(id, (selfMicros.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0));
});
const byFrame = new Map();
for (const [id, micros] of selfMicros) {
  const n = nodes.get(id);
  if (!n) continue;
  const f = n.callFrame;
  const url = f.url ? f.url.replace(/^.*\/(src|node_modules)\//, '$1/').split('?')[0] : '';
  const key = `${f.functionName || '(anonymous)'}  ${url}${f.lineNumber >= 0 ? ':' + (f.lineNumber + 1) : ''}`;
  byFrame.set(key, (byFrame.get(key) ?? 0) + micros);
}
const top = [...byFrame.entries()].sort((x, y) => y[1] - x[1]).slice(0, 30);
console.log(`\ntop self-time over ${(total / 1e6).toFixed(1)}s of samples:`);
for (const [key, micros] of top) {
  console.log(`  ${((micros / total) * 100).toFixed(1).padStart(5)}%  ${(micros / 1000).toFixed(0).padStart(6)}ms  ${key}`);
}

const stamp = label.replace(/[^\w.-]+/g, '_');
fs.writeFileSync(path.join(outDir, `${stamp}.cpuprofile`), JSON.stringify(profile));
fs.writeFileSync(
  path.join(outDir, `${stamp}.json`),
  JSON.stringify({ label, level, throttle, seconds, glInfo, endState, player: rec.player, stats: { all: stats(dt), action: stats(action), heavy: stats(heavy) }, dt: rec.dt, live: rec.live, pop: rec.pop, lv: rec.lv, ov: rec.ov, heap: rec.heap }),
);
console.log(`\nwrote ${path.join(outDir, `${stamp}.cpuprofile`)} and .json`);

if (errors.length) {
  console.error(`\n${errors.length} page errors:`);
  for (const e of errors.slice(0, 10)) console.error(`  ${e}`);
  process.exit(1);
}
