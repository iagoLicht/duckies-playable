#!/usr/bin/env node
/**
 * Level budget tuning harness — NOT a vitest test.
 *
 *   node tests/tools/tune-levels.mjs
 *   node tests/tools/tune-levels.mjs --seeds=500
 *   node tests/tools/tune-levels.mjs --level=3 --seeds=1000
 *
 * Runs the same distracted-thumb bot the playthrough gate uses (tests/sim/bot.ts)
 * over every level with the move budget disabled, and reports how many SHOTS the
 * bot actually needed. Those percentiles are the input for each level's `moves`:
 * pick a budget around p75-p90 and the level lands in "one shot to spare"
 * territory for a competent player, which is the near-miss feel we want.
 *
 * The sim is real TypeScript with extensionless imports, which bare node cannot
 * resolve, so we bundle it in-memory with esbuild (already installed as a vite
 * dependency) and import the result from a data: URL. No build step, no temp
 * files, no vitest.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : Number(hit.split('=')[1]);
};
const SEEDS = arg('seeds', 200);
const ONLY = arg('level', -1);

/** Bundle the sim + the shared bot to ESM and import it straight from memory. */
async function loadSim() {
  const res = await build({
    stdin: {
      contents: [
        "export { playLevel, pct } from './tests/sim/bot.ts';",
        "export { LEVELS } from './src/sim/levels.ts';",
      ].join('\n'),
      resolveDir: ROOT,
      sourcefile: 'tune-levels-entry.ts',
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

const avg = (rows, f) => (rows.length ? rows.reduce((s, r) => s + f(r), 0) / rows.length : 0);

function table(rows, columns) {
  const head = columns.map((c) => c.title);
  const body = rows.map((r) => columns.map((c) => String(c.get(r))));
  const width = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells) =>
    cells.map((c, i) => (columns[i].left ? c.padEnd(width[i]) : c.padStart(width[i]))).join('  ');
  return [line(head), width.map((w) => '-'.repeat(w)).join('  '), ...body.map(line)].join('\n');
}

const main = async () => {
  const { playLevel, pct, LEVELS } = await loadSim();

  if (LEVELS.length === 0) {
    console.error('LEVELS is empty — nothing to tune.');
    process.exit(1);
  }

  const indices = ONLY >= 0 ? [ONLY] : LEVELS.map((_, i) => i);
  if (indices.some((i) => i < 0 || i >= LEVELS.length)) {
    console.error(`--level must be 0..${LEVELS.length - 1}`);
    process.exit(1);
  }

  console.log(
    `tuning ${indices.length} level(s) x ${SEEDS} seeds, unlimited move budget ` +
    `(shots-used is the tuning signal)\n`,
  );

  const rows = [];
  const t0 = Date.now();
  for (const index of indices) {
    const level = LEVELS[index];
    const runs = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      runs.push(playLevel(index, seed, { unlimitedMoves: true }));
    }
    const wins = runs.filter((r) => r.won);
    const shots = wins.map((r) => r.shots).sort((a, b) => a - b);
    rows.push({
      index,
      name: level.name,
      goals: level.barrels.length + level.clams.length,
      barrels: level.barrels.length,
      clams: level.clams.length,
      moves: level.moves,
      assist: level.assist,
      winRate: wins.length / runs.length,
      p50: pct(shots, 0.5),
      p75: pct(shots, 0.75),
      p90: pct(shots, 0.9),
      max: shots.length ? shots[shots.length - 1] : 0,
      blasts: avg(runs, (r) => r.blasts),
      clamsOpened: avg(runs, (r) => r.clamsOpened),
      seconds: avg(runs, (r) => r.seconds),
      losses: runs.length - wins.length,
    });
    process.stderr.write(`  level ${index} "${level.name}" done\n`);
  }

  console.log(table(rows, [
    { title: 'lvl', get: (r) => r.index },
    { title: 'name', get: (r) => r.name, left: true },
    { title: 'goals', get: (r) => `${r.goals} (${r.barrels}b+${r.clams}c)`, left: true },
    { title: 'moves', get: (r) => r.moves },
    { title: 'assist', get: (r) => r.assist.toFixed(2) },
    { title: 'win%', get: (r) => (r.winRate * 100).toFixed(1) },
    { title: 'p50', get: (r) => r.p50 },
    { title: 'p75', get: (r) => r.p75 },
    { title: 'p90', get: (r) => r.p90 },
    { title: 'max', get: (r) => r.max },
    { title: 'blasts', get: (r) => r.blasts.toFixed(1) },
    { title: 'clams', get: (r) => r.clamsOpened.toFixed(1) },
    { title: 'secs', get: (r) => r.seconds.toFixed(1) },
    { title: 'suggest', get: (r) => r.p90 },
  ]));

  const bad = rows.filter((r) => r.winRate < 1);
  if (bad.length > 0) {
    console.log(
      `\nUNSOLVED on some seeds (level data problem, not a budget problem): ` +
      bad.map((r) => `${r.index} "${r.name}" ${r.losses} loss(es)`).join(', '),
    );
  }
  console.log(
    `\n'suggest' is the p90 shot count: a budget there clears ~9 runs in 10 with\n` +
    `little to spare. Drop to p75 for a tighter, more anxious level; go to max for\n` +
    `a tutorial board that must never be lost.\n` +
    `\n${(Date.now() - t0) / 1000}s total.`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
