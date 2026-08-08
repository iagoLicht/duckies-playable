#!/usr/bin/env node
/**
 * Clock-rig calibration harness — NOT a vitest test.
 *
 *   node tests/tools/calibrate-clock.mjs                     # level 9, shipped quota
 *   node tests/tools/calibrate-clock.mjs --quotas=24,26,28   # sweep pearl quotas
 *   node tests/tools/calibrate-clock.mjs --level=9 --seeds=300 --moves=13
 *
 * The ad's second beat is designed to be taken by the CLOCK, close enough to
 * the quota that the loss reads as a near miss. This measures that claim
 * instead of guessing at it: the shared bot plays the board under the real
 * clock AND the real move budget, at two skill levels —
 *
 *   thumb    the shipped "distracted thumb" (the playthrough gate's player)
 *   focused  the same bot thinking faster and aiming straighter — the engaged
 *            player who should sometimes actually win
 *
 * — and reports, per candidate quota: win rate, why runs ended, and how many
 * pearls the losses were short by. Pick the quota where the thumb loses by a
 * hair and the focused player wins a real-but-minority share.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const argNum = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : Number(hit.split('=')[1]);
};
const argList = (name) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? null : hit.split('=')[1].split(',').map(Number);
};
const LEVEL = argNum('level', 9);
const SEEDS = argNum('seeds', 300);
const MOVES = argNum('moves', -1); // -1: use the level's shipped budget
const QUOTAS = argList('quotas');
// pace-governor overrides; -1 leaves the level's shipped value. --pace=off
// removes the block entirely, measuring the un-steered board.
const PACE_OFF = process.argv.includes('--pace=off');
const TARGET_LEFT = argNum('targetLeft', -1);
const SPREAD = argNum('spread', -1);
const COLOUR_GAIN = argNum('colourGain', -1);
const ASSIST_GAIN = argNum('assistGain', -1);
const CLAM_XS = argList('clamx'); // e.g. --clamx=190,530 repositions the clams
const SPAWN_Y1 = argNum('spawnY1', -1); // deepen the spawn region's bottom edge

const SKILLS = {
  thumb: {},
  focused: { aimNoiseDeg: 4, thinkMin: 1.0, thinkJitter: 0.5, preferNoise: 0.4 },
};

async function loadSim() {
  const res = await build({
    stdin: {
      contents: [
        "export { playLevel, pct } from './tests/sim/bot.ts';",
        "export { LEVELS } from './src/sim/levels.ts';",
      ].join('\n'),
      resolveDir: ROOT,
      sourcefile: 'calibrate-clock-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false,
    logLevel: 'warning',
  });
  const code = res.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

const { playLevel, pct, LEVELS } = await loadSim();
const level = LEVELS[LEVEL];
if (!level) {
  console.error(`no level ${LEVEL}`);
  process.exit(1);
}
const quotas = QUOTAS ?? [level.pearls];
const shippedMoves = level.moves;
if (MOVES > 0) level.moves = MOVES;
if (PACE_OFF) delete level.pace;
else if (level.pace) {
  if (TARGET_LEFT >= 0) level.pace.targetLeft = TARGET_LEFT;
  if (SPREAD >= 0) level.pace.spread = SPREAD;
  if (COLOUR_GAIN >= 0) level.pace.colourGain = COLOUR_GAIN;
  if (ASSIST_GAIN >= 0) level.pace.assistGain = ASSIST_GAIN;
}

if (CLAM_XS) {
  CLAM_XS.forEach((x, i) => {
    if (level.clams[i]) level.clams[i].x = x;
  });
}
if (SPAWN_Y1 > 0) level.spawnRegion.y1 = SPAWN_Y1;

console.log(
  `level ${LEVEL} "${level.name}" — ${SEEDS} seeds, clock ON, ` +
  `moves ${level.moves}${MOVES > 0 ? ` (shipped ${shippedMoves})` : ''}, ` +
  `quotas [${quotas.join(', ')}], clams [${level.clams.map((c) => c.x).join(', ')}], ` +
  `pace ${level.pace ? JSON.stringify(level.pace) : 'off'}\n`,
);

for (const skillName of Object.keys(SKILLS)) {
  console.log(`— ${skillName} —`);
  for (const q of quotas) {
    level.pearls = q;
    const runs = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      runs.push(playLevel(LEVEL, seed, { unlimitedMoves: false, ...SKILLS[skillName] }));
    }
    const wins = runs.filter((r) => r.won);
    const losses = runs.filter((r) => !r.won);
    const left = losses.map((r) => r.pearlsLeft).sort((a, b) => a - b);
    const byTime = losses.filter((r) => r.end === 'failed' && r.seconds >= 29.5).length;
    const cratesStanding = losses.filter((r) => r.barrelsLeft > 0).length;
    const share = (n) => ((n / Math.max(1, losses.length)) * 100).toFixed(0).padStart(3) + '%';
    console.log(
      `quota ${String(q).padStart(2)}: win ${((wins.length / runs.length) * 100).toFixed(1).padStart(5)}%  ` +
      `losses ${String(losses.length).padStart(3)}  ` +
      `left p25/p50/p75/p90 ${pct(left, 0.25)}/${pct(left, 0.5)}/${pct(left, 0.75)}/${pct(left, 0.9)}  ` +
      `≤3:${share(left.filter((v) => v <= 3).length)} ≤5:${share(left.filter((v) => v <= 5).length)} ` +
      `≤9:${share(left.filter((v) => v <= 9).length)}  ` +
      `clock-took-it:${share(byTime)}  crates-standing:${share(cratesStanding)}`,
    );
  }
}
