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
