// The sound layer has no pixels, so the only way to verify it is to play and
// read the Audio class's own counters. This drives REAL gestures — page.mouse,
// or CDP touch events with --touch — through the whole grab/aim/release path,
// exactly the input a player produces, unlike the flow harness's slingshot-API
// driver which never exercises the unlock.
//
//   node tests/audio-probe.mjs [url] [--shots=N] [--touch]
//
// Needs the dev server (window.__scene / window.__audio are dev-only). Chromium
// is launched with autoplay REQUIRING a gesture, so the unlock story is tested
// under the shipped policy, not the test-runner default.
//
// What it gates, beyond "some sound played":
//  - the FIRST launched shot must voice its release and flight — the audio
//    cold start (context + decode) must not be paid out of the opening shots
//    (regression: decode used to start on the first grab and the entire first
//    flight fell past the LATE_PLAY grace, silently)
//  - the grab sound must play, the context must end 'running'
//  - no console errors (the dev server's stray /favicon.ico 404 excepted)
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5199/?level=9';
const shotsWanted = Number((args.find((a) => a.startsWith('--shots=')) ?? '--shots=4').slice(8));
const useTouch = args.includes('--touch');

const browser = await chromium.launch({
  headless: false, // headless swaps the GL stack AND relaxes gesture rules
  args: ['--autoplay-policy=user-gesture-required', '--mute-audio'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  ...(useTouch ? { hasTouch: true, isMobile: true } : {}),
});
const page = await context.newPage();
const cdp = useTouch ? await context.newCDPSession(page) : null;
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) {
    errors.push(`console.error: ${m.text()} @ ${m.location().url}`);
  }
});

await page.goto(target);
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 20000 });

const view = () => page.evaluate(() => {
  const s = window.__scene;
  const root = s.app.stage.children[0];
  return {
    rootX: root.position.x, rootY: root.position.y, scale: root.scale.x,
    // boardReady is the same gate the pointer handler enforces — grabbing
    // before it is refused by design and would read as a probe failure
    open: s.boardReady() && !s.director.won && !s.director.failed,
    over: s.director.won || s.director.failed,
    movesLeft: s.director.movesLeft,
    ducks: s.director.world.ducks.filter((d) => !d.live && !d.popping && !d.matched)
      .map((d) => ({ id: d.id, x: d.x, y: d.y })),
  };
});
const audio = () => page.evaluate(() => {
  const a = window.__audio;
  return { state: a.state, played: Object.fromEntries(a.played), dropped: Object.fromEntries(a.dropped) };
});

const move = async (x, y) => {
  if (cdp) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x, y, radiusX: 4, radiusY: 4, force: 1 }],
    });
  } else await page.mouse.move(x, y, { steps: 2 });
};
const down = async (x, y) => {
  if (cdp) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x, y, radiusX: 4, radiusY: 4, force: 1 }],
    });
  } else { await page.mouse.move(x, y); await page.mouse.down(); }
};
const up = async () => {
  if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  else await page.mouse.up();
};

let launched = 0;
let firstShotRelease = null;
for (let attempt = 0; attempt < 60 && launched < shotsWanted; attempt++) {
  const v = await view();
  if (v.over) break;
  if (!v.open || v.ducks.length < 2) { await page.waitForTimeout(300); continue; }
  const duck = v.ducks[Math.floor(Math.random() * v.ducks.length)];
  const to = (x, y) => [v.rootX + x * v.scale, v.rootY + y * v.scale];
  await down(...to(duck.x, duck.y));
  let legal = false;
  for (let k = 0; k < 24 && !legal; k++) {
    const ang = (k / 24) * Math.PI * 2;
    await move(...to(duck.x - Math.cos(ang) * 140, duck.y - Math.sin(ang) * 140));
    legal = await page.evaluate(() => window.__scene.director.slingshot.preview()?.hitKind === 'duck');
  }
  await page.waitForTimeout(120);
  await up();
  await page.waitForTimeout(1600); // let the flight and its chain be heard
  const after = await view();
  if (after.movesLeft === v.movesLeft - 1) {
    launched++;
    const a = await audio();
    if (launched === 1) firstShotRelease = a.played.launchRelease ?? 0;
    console.log(`shot ${launched}: state=${a.state} played=${JSON.stringify(a.played)}`);
  } else {
    await page.waitForTimeout(300); // refused (red X held, or board not truly open): not a shot
  }
}

const a = await audio();
await browser.close();

const total = Object.values(a.played).reduce((s, n) => s + n, 0);
console.log(`\n${launched} shots launched, ${total} plays accepted, state=${a.state}`);
console.log(`dropped: ${JSON.stringify(a.dropped)}`);

const fails = [];
if (launched === 0) fails.push('no shot could be launched');
if (a.state !== 'running') fails.push(`context ended '${a.state}', not running`);
if ((a.played.launchPull ?? 0) === 0) fails.push('the grab never sounded');
if (firstShotRelease === 0) fails.push('the FIRST launched shot had a silent release (cold-start regression)');
if ((a.played.duckBump ?? 0) + (a.played.wallBump ?? 0) === 0) fails.push('no flight was heard at all');
for (const e of errors.slice(0, 5)) fails.push(e);
if (fails.length) {
  console.error(`\nAUDIO PROBE FAILED:\n  ${fails.join('\n  ')}`);
  process.exit(1);
}
console.log(`\naudio clean under real ${useTouch ? 'touch' : 'mouse'} gestures`);
