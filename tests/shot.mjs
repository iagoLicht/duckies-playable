// Screenshot the playable at phone/tablet viewports and relay console errors.
//   node tests/shot.mjs                          -> dev server, default viewport
//   node tests/shot.mjs --all                    -> all three viewports
//   node tests/shot.mjs dist/duckies-pop-playable.html --all   -> built file
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const all = args.includes('--all');
const target = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5173';
const url = target.startsWith('http') ? target : pathToFileURL(path.resolve(target)).href;

const VIEWPORTS = all
  ? [[360, 640], [412, 915], [820, 1180]]
  : [[412, 915]];

fs.mkdirSync('shots', { recursive: true });
const browser = await chromium.launch();
let failed = false;

try {
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
    // Deterministic readiness: boot() sets the flag once the scene is built. A blind
    // sleep here could screenshot a not-yet-booted blank canvas and still "pass".
    try {
      await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 15000 });
    } catch {
      failed = true;
      console.error(`[not-ready @${w}x${h}] __sceneReady never set — boot hung or crashed`);
    }
    await page.waitForTimeout(500); // let the first animation frames land
    const name = `shots/${url.startsWith('file') ? 'build' : 'dev'}-${w}x${h}.png`;
    await page.screenshot({ path: name });
    console.log(`wrote ${name}`);
    await page.close();
  }
} finally {
  await browser.close();
}

process.exitCode = failed ? 1 : 0;
