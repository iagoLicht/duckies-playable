// End-to-end validation of the ad's rigged flow in a real browser:
//   L9 played to a win -> win card -> NEXT LEVEL -> L10 -> (usually) clock loss
// with the near-miss read checked at 0:00, over several runs.
//
//   node tests/rigged-flow.mjs [url] --runs=3 [--headed]
//
// Uses the dev server (needs window.__scene). The driver only calls the public
// slingshot API, so the sim plays by every shipped rule — budget, clock,
// governor — while wall-clock timing makes each run an independent sample.
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flagOf = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.slice(name.length + 3)) : dflt;
};
const target = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5199';
const runsWanted = flagOf('runs', 3);
const headed = args.includes('--headed');

const browser = await chromium.launch({ headless: !headed });
const results = [];

for (let run = 1; run <= runsWanted; run++) {
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
        if (now >= st.holdUntil) { if (!sl.end()) sl.cancel(); st.nextAt = now + 1300 + rng() * 800; }
      } else if (dir.readyForInput && now >= st.nextAt && !dir.won && !dir.failed) {
        const ducks = dir.world.ducks.filter((d) => !d.live && !d.popping && !d.matched);
        if (ducks.length >= 2) {
          const duck = ducks[Math.floor(rng() * ducks.length)];
          const others = dir.world.ducks.filter((d) => d.id !== duck.id && !d.popping);
          // the sim bot's target scoring (tests/sim/bot.ts): prefer targets
          // whose deflection line carries into a goal, and same-colour mates
          const DUCK_R = 46, BARREL_R = 60, CLAM_R = 56;
          const caroms = (t) => {
            const ux = t.x - duck.x, uy = t.y - duck.y;
            const len = Math.hypot(ux, uy) || 1;
            const dx = ux / len, dy = uy / len;
            const reaches = (gx, gy, r) => {
              const bx = gx - t.x, by = gy - t.y;
              const along = bx * dx + by * dy;
              if (along <= 0 || along > 700) return false;
              return Math.abs(bx * dy - by * dx) < r + DUCK_R * 0.6;
            };
            return dir.world.barrels.some((b) => reaches(b.x, b.y, BARREL_R))
              || dir.world.clams.some((c) => c.active && reaches(c.x, c.y, CLAM_R));
          };
          const scored = others.map((t) => ({
            t, s: (caroms(t) ? 3 : 0) + (t.colour === duck.colour ? 2 : 0) + rng() * 1.5,
          }));
          scored.sort((x, y) => y.s - x.s);
          const t2 = scored[0].t;
          if (sl.begin(duck.x, duck.y)) {
            // the bot's ±10° of thumb noise
            const base = Math.atan2(t2.y - duck.y, t2.x - duck.x) + ((rng() - 0.5) * 20 * Math.PI) / 180;
            aimFrom(duck, base);
            let k = 1;
            while (sl.preview()?.hitKind !== 'duck' && k <= 40) {
              aimFrom(duck, base + Math.ceil(k / 2) * (Math.PI / 60) * (k % 2 ? 1 : -1));
              k++;
            }
            if (sl.preview()?.hitKind !== 'duck') { sl.cancel(); st.nextAt = now + 250; }
            else st.holdUntil = now + 300;
          }
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, 7700 + run * 131);

  const state = () => page.evaluate(() => {
    const s = window.__scene;
    const root = s.app.stage.children[0];
    const card = root.children[2].children.find((c) => c.visible);
    const btn = card ? card.children.find((c) => c.cursor === 'pointer') : null;
    return {
      lv: s.director.levelIndex,
      won: s.director.won,
      failed: s.director.failed,
      pearlsLeft: s.director.pearlCounter.left,
      pearlsTotal: s.director.pearlCounter.total,
      crates: s.director.world.barrels.length,
      movesLeft: s.director.movesLeft,
      simTime: s.director.world.time,
      card: !!card,
      clickable: !!btn && btn.eventMode === 'static',
      rootX: root.position.x, rootY: root.position.y, scale: root.scale.x,
    };
  });

  const r = { run, l9: null, transition: false, l10: null, errors };
  const t0 = Date.now();
  while (Date.now() - t0 < 150000) {
    await page.waitForTimeout(700);
    const st = await state();
    if (st.lv === 8 && (st.won || st.failed) && !r.l9) {
      r.l9 = st.won ? 'won' : 'lost (authored TRY AGAIN ending — beat 1 is ~95% won)';
    }
    // a lost beat 1 ends the run at the terminal card — an authored ending,
    // not a flow failure; the run simply never samples beat 2
    if (st.card && st.clickable && st.lv === 8 && st.failed) break;
    if (st.card && st.clickable && st.lv === 8) {
      await page.mouse.click(st.rootX + 360 * st.scale, st.rootY + 675 * st.scale);
      await page.waitForTimeout(400);
      const after = await state();
      r.transition = after.lv === 9;
    }
    if (st.lv === 9 && (st.won || st.failed) && st.card && st.clickable) {
      r.l10 = {
        outcome: st.won ? 'won' : 'lost',
        pearlsLeft: st.pearlsLeft,
        pearlsTotal: st.pearlsTotal,
        crates: st.crates,
        movesLeft: st.movesLeft,
        simTime: Math.round(st.simTime * 10) / 10,
      };
      break;
    }
  }
  await page.close();
  results.push(r);
  console.log(
    `run ${run}: L9 ${r.l9}  transition ${r.transition ? 'ok' : 'MISSING'}  ` +
    `L10 ${r.l10 ? `${r.l10.outcome} — ${r.l10.pearlsLeft}/${r.l10.pearlsTotal} pearls left, ` +
      `${r.l10.crates} crates standing, ${r.l10.movesLeft} moves left, t=${r.l10.simTime}s` : 'NO RESULT'}  ` +
    `errors ${errors.length}`,
  );
  for (const e of errors.slice(0, 5)) console.log('   ', e);
}
await browser.close();

const bad = results.filter(
  (r) => r.errors.length > 0 || (r.l9 === 'won' && (!r.transition || !r.l10)),
);
if (bad.length) {
  console.error(`\n${bad.length}/${results.length} runs broke the scripted flow`);
  process.exit(1);
}
const sampled = results.filter((r) => r.l10).length;
console.log(`\nflow clean on all ${results.length} runs (${sampled} sampled beat 2 end-to-end)`);
