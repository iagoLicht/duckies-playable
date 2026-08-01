// Stages game assets from the Candivore pack into src/assets/.
// PNG -> WebP at unchanged dimensions (Spine atlas UVs depend on exact pixel size).
// Run: npm run assets
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import subsetFont from 'subset-font';

const PACK = process.env.DUCKIES_PACK
  ?? 'C:/Users/licht/OneDrive/Desktop/Candivore/Marketing AI Student_Ready/duckies-playable-home-test 3/assets';
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

/** PNG -> WebP, same dimensions (never resized). q: quality. */
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
