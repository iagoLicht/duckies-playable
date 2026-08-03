import { describe, expect, it } from 'vitest';
import { SIM } from '../../src/sim/config';
import { Director } from '../../src/sim/director';
import { mulberry32 } from '../../src/sim/rng';

/**
 * A mediocre-on-purpose bot: every ~2s it grabs a random resting duck and
 * slings it at another duck — mostly a same-colour mate, sometimes any other
 * duck just to stir the field — with +/-10 degrees of aim noise. Shots must
 * reach a duck to fire at all now, so noisy aims sometimes whiff outright;
 * aim assist is expected to carry it — the playable must be winnable by a
 * distracted human thumb.
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

    // matched ducks wear no ring and refuse a grab — a player wouldn't tap one
    const resting = dir.world.ducks.filter((d) => !d.live && !d.popping && !d.matched);
    if (resting.length === 0) continue;
    const duck = resting[Math.floor(rng() * resting.length)]!;

    // pick a target DUCK (barrel aims are refused). Play the game the way the
    // white deflection arrow teaches: a dead-on hit sends the STRUCK duck
    // onward along the line of centres, so favour targets whose deflection
    // line carries into a surviving barrel (the carom does the crate damage),
    // and same-colour mates for the match. A dash of preference noise keeps it
    // a thumb, not a snooker engine.
    const others = dir.world.ducks.filter((d) => d.id !== duck.id && !d.popping);
    if (others.length === 0) continue;
    const caromsIntoBarrel = (t: { x: number; y: number }): boolean => {
      const ux = t.x - duck.x, uy = t.y - duck.y;
      const len = Math.hypot(ux, uy) || 1;
      const dx = ux / len, dy = uy / len;
      return dir.world.barrels.some((b) => {
        const bx = b.x - t.x, by = b.y - t.y;
        const along = bx * dx + by * dy;
        if (along <= 0 || along > 700) return false;
        const off = Math.abs(bx * dy - by * dx);
        return off < SIM.BARREL_R + SIM.DUCK_R * 0.6;
      });
    };
    const scored = others.map((t) => ({
      t,
      s: (caromsIntoBarrel(t) ? 3 : 0) + (t.colour === duck.colour ? 2 : 0) + rng() * 1.5,
    }));
    scored.sort((a, b) => b.s - a.s);
    const best = scored[0]!.t;
    const tx = best.x, ty = best.y;

    let ang = Math.atan2(ty - duck.y, tx - duck.x);
    ang += ((rng() - 0.5) * 20 * Math.PI) / 180; // +/-10 deg noise
    const pull = 140 + rng() * 60;
    if (dir.slingshot.begin(duck.x, duck.y)) {
      const aimAt = (a: number): void =>
        dir.slingshot.move(duck.x - Math.cos(a) * pull, duck.y - Math.sin(a) * pull);
      aimAt(ang);
      // like a player: the release is refused while the X shows, so swing the
      // aim outward from the intended angle until the guide locks a duck —
      // all the way around if needed (that's how the bank shots happen)
      if (dir.slingshot.preview()?.hitKind !== 'duck') {
        for (let s = 1; s <= 60; s++) {
          const off = (s * 3 * Math.PI) / 180;
          aimAt(ang + off);
          if (dir.slingshot.preview()?.hitKind === 'duck') break;
          aimAt(ang - off);
          if (dir.slingshot.preview()?.hitKind === 'duck') break;
        }
      }
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
      if (seed % 25 === 0) await new Promise((r) => setTimeout(r, 0));
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
