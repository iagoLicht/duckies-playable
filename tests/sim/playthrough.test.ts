import { describe, expect, it } from 'vitest';
import { SIM } from '../../src/sim/config';
import { Director } from '../../src/sim/director';
import { mulberry32 } from '../../src/sim/rng';

/**
 * A mediocre-on-purpose bot: every ~2s it grabs a random resting duck and
 * slings it toward the nearest barrel (or a same-colour duck 30% of the time)
 * with +/-10 degrees of aim noise. Aim assist is expected to carry it — the
 * playable must be winnable by a distracted human thumb.
 */
interface RunStats {
  won: boolean;
  seconds: number;
  finaleArmed: boolean;
  blasts: number;
}

function playOnce(seed: number): RunStats {
  const rng = mulberry32(seed * 7919 + 1);
  const dir = new Director(seed);
  dir.start();
  let nextShotAt = 1.2;
  let blasts = 0;
  let finaleArmed = false;
  const MAX_SECONDS = 120;

  while (!dir.won && dir.world.time < MAX_SECONDS) {
    dir.step(SIM.DT);
    for (const e of dir.drained.splice(0, dir.drained.length)) {
      if (e.type === 'blast') blasts++;
      if (e.type === 'finaleArmed') finaleArmed = true;
    }
    if (dir.world.time < nextShotAt) continue;
    nextShotAt = dir.world.time + 1.6 + rng() * 0.9;

    const resting = dir.world.ducks.filter((d) => !d.live && !d.popping);
    if (resting.length === 0) continue;
    const duck = resting[Math.floor(rng() * resting.length)]!;

    // pick a target: nearest barrel, or 30% a same-colour duck when one exists
    let tx: number, ty: number;
    const mates = dir.world.ducks.filter((d) => d.id !== duck.id && d.colour === duck.colour);
    if (mates.length > 0 && rng() < 0.3) {
      const m = mates[Math.floor(rng() * mates.length)]!;
      tx = m.x; ty = m.y;
    } else if (dir.world.barrels.length > 0) {
      const b = [...dir.world.barrels].sort(
        (p, q) => Math.hypot(p.x - duck.x, p.y - duck.y) - Math.hypot(q.x - duck.x, q.y - duck.y),
      )[0]!;
      tx = b.x; ty = b.y;
    } else {
      continue;
    }

    let ang = Math.atan2(ty - duck.y, tx - duck.x);
    ang += ((rng() - 0.5) * 20 * Math.PI) / 180; // +/-10 deg noise
    const pull = 140 + rng() * 60;
    const sx = duck.x - Math.cos(ang) * pull;
    const sy = duck.y - Math.sin(ang) * pull;
    if (dir.slingshot.begin(duck.x, duck.y)) {
      dir.slingshot.move(sx, sy);
      dir.slingshot.end();
    }
  }
  return { won: dir.won, seconds: dir.world.time, finaleArmed, blasts };
}

describe('level playthrough statistics', () => {
  it('600 bot runs: everyone wins, pacing lands near 40s, finale fires', async () => {
    const runs: RunStats[] = [];
    for (let seed = 1; seed <= 600; seed++) {
      runs.push(playOnce(seed));
      // ~2min of synchronous CPU starves the worker's event loop and the reporter
      // RPC ("onTaskUpdate") times out. Yielding periodically keeps it alive.
      if (seed % 25 === 0) await new Promise((r) => setImmediate(r));
    }

    const winRate = runs.filter((r) => r.won).length / runs.length;
    const times = runs.map((r) => r.seconds).sort((a, b) => a - b);
    const p50 = times[Math.floor(times.length / 2)]!;
    const p90 = times[Math.floor(times.length * 0.9)]!;
    const finaleRate = runs.filter((r) => r.finaleArmed).length / runs.length;
    const avgBlasts = runs.reduce((s, r) => s + r.blasts, 0) / runs.length;

    // eslint-disable-next-line no-console
    console.log({ winRate, p50: p50.toFixed(1), p90: p90.toFixed(1), finaleRate, avgBlasts: avgBlasts.toFixed(1) });

    expect(winRate).toBe(1);
    expect(p50).toBeGreaterThan(25);
    expect(p50).toBeLessThan(55);
    expect(p90).toBeLessThan(80);
    expect(finaleRate).toBeGreaterThan(0.85);
    expect(avgBlasts).toBeGreaterThan(4);
    // 600 runs is ~2min of CPU here. The old 120s budget never fired while the loop
    // blocked the event loop; now that it yields, the timer works — so give it real
    // headroom. This bounds a hang, it does not assert performance.
  }, 600_000);
});
