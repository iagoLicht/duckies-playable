// Stages game assets from the Candivore pack into src/assets/.
// PNG -> WebP at unchanged dimensions (Spine atlas UVs depend on exact pixel size).
// Run: npm run assets
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import subsetFont from 'subset-font';

const PACK = process.env.DUCKIES_PACK
  ?? 'C:/Users/licht/OneDrive/Desktop/Candivore/Marketing AI Student_Ready/duckies-playable-home-test 3/assets';
/**
 * The board HUD reassembly, which ships its own art alongside the spec — the
 * top-left avatar character in particular, which is not in the pack. Entries
 * that come from here carry `root: BOARD`.
 */
const BOARD = process.env.DUCKIES_BOARD
  ?? 'C:/Users/licht/OneDrive/Desktop/Candivore/UI component reassembly- Board';
const OUT = 'src/assets';

/** Copied byte-for-byte (skeletons, atlases, audio). */
const COPY = [
  'entities/ducky/ducky.skel', 'entities/ducky/ducky.atlas',
  'entities/crate-round/crate-round.skel', 'entities/crate-round/crate-round.atlas',
  'entities/tutorial-hand/tutorial-hand.json', 'entities/tutorial-hand/tutorial-hand.atlas',
  // manifest "Bumper (Oyster)": GameEntityBumper renders as this oyster
  // (SpineAnimOnHit='bump'); skins normal/gold/baby. It is also the shell that
  // spills pearl.png — our clams.
  'entities/oyster/oyster.skel', 'entities/oyster/oyster.atlas',
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
  { src: 'entities/crate-round/crate-round.png', q: 80 },           // atlas page — THE barrel (game's ribbon-strip mechanic)
  { src: 'entities/tutorial-hand/tutorial-hand.png', q: 80 },       // atlas page
  // atlas page — the clam. NOTE the source is oyster.ORIG.png: the pack's
  // oyster.png is a 2x upscale (592x544) while the atlas declares size:296,272,
  // so staging oyster.png makes loadSkeleton's page-size assertion throw and the
  // clam never loads. oyster.orig.png is the page the atlas actually describes.
  { src: 'entities/oyster/oyster.orig.png', out: 'entities/oyster/oyster.webp', q: 82 },
  { src: 'entities/oyster/pearl.png', q: 88 },                      // manifest: "52x52 glossy pearl … the droppable pearl it spills"
  { src: 'theme/in-game-bg.png', q: 60 },                           // full-screen bg, flat art survives low q
  // TRIMMED: both goal icons ship with a lot of transparent margin, and
  // different amounts of it (the shell fills 88% of its 256 square, the barrel
  // only 73x82%). Drawn at one nominal size the barrel therefore reads much
  // smaller than the shell. Trimming to the art means the HUD can size them by
  // what is actually visible, each keeping its own proportions.
  { src: 'icons/goal-Barrel.png', q: 75, trim: true },
  // the pink shell with a pearl in it — the HUD's clam-goal icon. The board
  // reassembly assigns it exactly that role, alongside goal-Barrel.
  { src: 'icons/goal-Bumper.png', q: 75, trim: true },
  { src: 'icons/goal-DuckAll.png', q: 75 },
  // the HUD bar's top-left character, already trimmed to its own bounds
  // (739x892). Not in the pack — it ships with the board reassembly.
  { src: 'TTeddy-trimmed.png', out: 'ui/hud-avatar.webp', q: 82, root: BOARD, width: 320 },
  { src: 'ui/btn-play-hero.png', q: 75 },
  { src: 'ui/hud-currency-plate.png', q: 75 },
  { src: 'ui/popup-body-tall.png', q: 75 },
  { src: 'ui/btn-green-large.png', q: 78 },                         // end-card CTA (578x227, no baked label)
  // the pack's own X (43x49, already trimmed to its art) — the refused-aim
  // marker. Replaces a hand-drawn two-stroke cross; see AIM_X_H in scene.ts
  { src: 'ui/icon-x.png', q: 88 },
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
];

/**
 * Colorized variants. bath-pool.png ships greyscale (a tint target); the game shows it
 * as light-blue water tiles. Linear per-channel map derived by fitting the greyscale
 * tile range onto the colour range of the reference (Downloads/colored-bath-pool.png,
 * tiles #10A9E0..#29C3EB — same look the vault example draws procedurally with
 * #4EC7F0 fill + #44B8E8 checker).
 */
const COLORIZE = [
  {
    src: 'theme/bath-pool.png',
    out: 'theme/bath-pool-blue.webp',
    a: [0.2874, 0.2989, 0.1264],
    b: [-11.3, 140.6, 212.0],
    q: 78,
  },
];

/**
 * Cropped tileable patches. bath-wall-tile: a clean 2×2-tile block of the pink
 * mosaic from in-game-bg.png (grout lines sit on a 90px grid; 172/434 are grout
 * starts, 180px = one full light/dark checker period), taken from a props-free
 * region so the tiled result shows no cropped bathroom objects.
 */
const EXTRACT = [
  {
    src: 'theme/in-game-bg.png',
    out: 'theme/bath-wall-tile.webp',
    left: 172, top: 434, width: 180, height: 180, q: 80,
  },
];

/**
 * Entity-style outlined variants: bake the white sticker outline + soft drop
 * shadow around a sprite, the way the entity atlas pages carry baked white base
 * blobs + blurred shadow pieces. grow = outline thickness in px at native scale
 * (pick so outline ≈ 8px at the sprite's final scene scale).
 */
const OUTLINE = [
  {
    src: 'entities/wall-bouncers/BouncyWall-small-tip-side.png',
    out: 'entities/wall-bouncers/BouncyWall-small-tip-side-outlined.webp',
    grow: 8, q: 82,
  },
];

async function bakeOutline(srcPath, outPath, grow, q) {
  const m = grow + 14; // margin for outline + shadow spill
  const meta = await sharp(srcPath).metadata();
  const W = meta.width + 2 * m;
  const H = meta.height + 2 * m;
  const padded = await sharp(srcPath).ensureAlpha()
    .extend({ top: m, bottom: m, left: m, right: m, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  // dilate the alpha: blur + low threshold grows the silhouette ~`grow`px with
  // naturally rounded (blobby) corners, matching the hand-drawn base style
  // two separate passes — inside one sharp pipeline the operation order is fixed
  // (threshold would run before blur), which would kill the dilation
  const blurredAlpha = await sharp(padded).extractChannel(3)
    .blur(grow / 1.3).png().toBuffer();
  const dilated = await sharp(blurredAlpha).threshold(8).png().toBuffer();
  const white = await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } })
    .joinChannel(dilated).png().toBuffer();
  const shadowAlpha = await sharp(dilated).blur(3).linear(0.25, 0).png().toBuffer();
  const shadow = await sharp({ create: { width: W, height: H, channels: 3, background: '#1c5a7a' } })
    .joinChannel(shadowAlpha).png().toBuffer();
  await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: shadow, top: 7, left: 0 },
      { input: white, top: 0, left: 0 },
      { input: padded, top: 0, left: 0 },
    ])
    .webp({ quality: q }).toFile(outPath);
}

/** Fonts -> woff2 subset. Title Case per brand rules, so keep both cases + digits + punctuation. */
const FONT_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 !?.,:/×+-\'"%';
// ONE FACE. CherryBombOne-Regular used to be staged here too, but nothing in the
// ad ever set fontFamily to it — the HUD and the end card both went to the
// condensed face — so it was ~21 KB of base64 in the single-file build for zero
// glyphs. Dropped 2026-08-08. The .ttf is still in the pack if it is ever wanted
// back; staging it again is this one line.
const FONTS = [
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

for (const { src: rel, out: outRel, q, root, width, trim } of WEBP) {
  const src = path.join(root ?? PACK, rel);
  // `out` only when the staged name differs from the source (see the clam)
  const out = path.join(OUT, outRel ?? rel.replace(/\.png$/, '.webp'));
  ensureDir(out);
  const inSize = fs.statSync(src).size;
  // `width` only for art that ships far larger than it is ever drawn, and
  // `trim` only for standalone sprites. Atlas pages must never get either —
  // their UVs are pixel addresses into an exact page size.
  let pipe = sharp(src);
  if (trim) pipe = pipe.trim({ threshold: 5 });
  await pipe.resize(width ?? null).webp({ quality: q }).toFile(out);
  const outSize = fs.statSync(out).size;
  totalIn += inSize;
  totalOut += outSize;
  console.log(`webp  ${rel.padEnd(58)} ${kb(inSize)} -> ${kb(outSize)} (q${q})`);
}

for (const { src: rel, out: outRel, a, b, q } of COLORIZE) {
  const src = path.join(PACK, rel);
  const out = path.join(OUT, outRel);
  ensureDir(out);
  const inSize = fs.statSync(src).size;
  await sharp(src).toColourspace('srgb').linear(a, b).webp({ quality: q }).toFile(out);
  const outSize = fs.statSync(out).size;
  totalIn += inSize;
  totalOut += outSize;
  console.log(`tint  ${rel.padEnd(58)} ${kb(inSize)} -> ${kb(outSize)} (q${q})`);
}

for (const { src: rel, out: outRel, left, top, width, height, q } of EXTRACT) {
  const src = path.join(PACK, rel);
  const out = path.join(OUT, outRel);
  ensureDir(out);
  const inSize = fs.statSync(src).size;
  await sharp(src).extract({ left, top, width, height }).webp({ quality: q }).toFile(out);
  const outSize = fs.statSync(out).size;
  totalIn += inSize;
  totalOut += outSize;
  console.log(`crop  ${rel.padEnd(58)} ${kb(inSize)} -> ${kb(outSize)} (q${q})`);
}

for (const { src: rel, out: outRel, grow, q } of OUTLINE) {
  const src = path.join(PACK, rel);
  const out = path.join(OUT, outRel);
  ensureDir(out);
  const inSize = fs.statSync(src).size;
  await bakeOutline(src, out, grow, q);
  const outSize = fs.statSync(out).size;
  totalIn += inSize;
  totalOut += outSize;
  console.log(`otln  ${rel.padEnd(58)} ${kb(inSize)} -> ${kb(outSize)} (grow ${grow})`);
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
