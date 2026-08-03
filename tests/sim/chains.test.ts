import { describe, expect, it } from 'vitest';
import { SIM } from '../../src/sim/config';
import { World } from '../../src/sim/world';
import type { SimEvent } from '../../src/sim/types';

interface Stamped { tick: number; e: SimEvent }

/** Step one tick at a time, stamping every event with the tick it fired on. */
const record = (w: World, ticks: number): Stamped[] => {
  const out: Stamped[] = [];
  w.events.length = 0; // drop the spawn events
  for (let tick = 0; tick < ticks; tick++) {
    w.step(SIM.DT);
    for (const e of w.events.splice(0, w.events.length)) out.push({ tick, e });
  }
  return out;
};

const firstTick = (log: Stamped[], type: SimEvent['type']): number =>
  log.find((s) => s.e.type === type)?.tick ?? -1;

/**
 * The official model (decomp `flagMatched`/`popDuck`/`explodeAt`, measured
 * against the shipped example): same-colour contact at speed does not pop, it
 * lights a 90-tick fuse. The duck keeps every bit of its physics while it burns
 * down, then pops and detonates. A blast dooms every duck it NEWLY catches,
 * whatever its colour (user-locked change over the official): nudged, blinking,
 * and popping only once it is fully idle — settled and held still for the
 * confirmation period, never mid-slide. A duck already on a contact fuse keeps
 * that fuse, so a matched pair still pops together.
 *
 * The fuse is decremented on the same tick it is lit, exactly as the official's
 * tick() does (its fuse pass runs after contact resolution) — so a duck reads
 * MATCH_FUSE_TICKS - 1 on the first tick you can observe it, and pops
 * MATCH_FUSE_TICKS - 1 ticks later.
 */
const FUSE = SIM.MATCH_FUSE_TICKS - 1;

describe('same-colour matches, fuses and chain blasts', () => {
  it('a same-colour pair lights both fuses instead of popping', () => {
    const w = new World(1);
    const a = w.spawnDuck('red', 300, 700);
    const b = w.spawnDuck('red', 460, 700);
    w.launch(a.id, 900, 0);
    const log = record(w, 20);

    const matched = log.filter((s) => s.e.type === 'duckMatched');
    expect(matched).toHaveLength(2);
    expect(matched.map((s) => (s.e as { id: number }).id).sort()).toEqual([a.id, b.id].sort());
    // both still in the world, blinking, with equal fuses
    expect(w.ducks).toHaveLength(2);
    expect(a.matched).toBe(true);
    expect(b.matched).toBe(true);
    expect(a.matchFuse).toBe(b.matchFuse);
    expect(a.matchFuse).toBe(FUSE - (19 - matched[0]!.tick));
    expect(log.some((s) => s.e.type === 'duckPopped')).toBe(false);
  });

  it('the pair pops one full fuse after contact, not on impact', () => {
    const w = new World(1);
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('red', 460, 700);
    w.launch(a.id, 900, 0);
    const log = record(w, 200);

    const matchTick = firstTick(log, 'duckMatched');
    expect(matchTick).toBeGreaterThanOrEqual(0);
    const pops = log.filter((s) => s.e.type === 'duckPopped');
    expect(pops).toHaveLength(2);
    // both fuses were lit on the same tick, so both ducks pop on the same tick
    expect(pops[0]!.tick).toBe(matchTick + FUSE);
    expect(pops[1]!.tick).toBe(matchTick + FUSE);
    // ~1.5s of blinking, and nothing popped a moment earlier
    expect(FUSE / 60).toBeGreaterThan(1.4);
    expect(FUSE / 60).toBeLessThan(1.6);
    expect(log.filter((s) => s.e.type === 'blast')).toHaveLength(2);
    expect(w.ducks).toHaveLength(0);
  });

  it('a matched duck is never re-flagged, however often it is hit', () => {
    const w = new World(1);
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('red', 460, 700);
    w.launch(a.id, 900, 0);
    // 200 ticks: the pair collides, blinks, bounces off walls into each other
    // again, and finally pops — still exactly one duckMatched apiece
    const log = record(w, 200);
    expect(log.filter((s) => s.e.type === 'duckMatched')).toHaveLength(2);
  });

  it('different colours never match', () => {
    const w = new World(1);
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('green', 460, 700);
    w.launch(a.id, 900, 0);
    const log = record(w, 240);
    expect(log.some((s) => s.e.type === 'duckMatched')).toBe(false);
    expect(w.ducks).toHaveLength(2);
  });

  it('a stationary pair does not spontaneously match', () => {
    const w = new World(1);
    w.spawnDuck('red', 300, 700);
    w.spawnDuck('red', 300 + SIM.DUCK_R * 2 + 1, 700);
    const log = record(w, 240);
    expect(log.some((s) => s.e.type === 'duckMatched')).toBe(false);
    expect(w.ducks).toHaveLength(2);
  });

  it('a blast dooms every duck it catches, whatever the colour; each pops once settled', () => {
    const w = new World(1);
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('red', 393, 700);
    // Blast reach is pure centre distance (135, no body-radius padding), and the
    // shooter drifts through its fuse before popping at (301.1, 700) — so the
    // bystanders are placed against that pop point, one lane-width clear of the
    // ducks' path at y = 700 so neither is knocked about on the way through.
    // third red parked well inside BLAST_R of where the pair goes off (117 away)
    const c = w.spawnDuck('red', 340, 810);
    // green bystander in the same blast (128 away) — doomed too: blasts are
    // colour-blind (user-locked 2026-08-03), each victim pops when it settles
    const green = w.spawnDuck('green', 235, 810);
    w.launch(a.id, 140, 0);
    const log = record(w, 600);

    const chainMatch = log.filter((s) => s.e.type === 'duckMatched' && (s.e as { id: number }).id === c.id);
    expect(chainMatch).toHaveLength(1);
    const blasts = log.filter((s) => s.e.type === 'blast');
    // two from the pair (same tick), then one per caught duck as it settles
    expect(blasts).toHaveLength(4);
    expect(blasts[0]!.tick).toBe(blasts[1]!.tick);
    expect(chainMatch[0]!.tick).toBe(blasts[0]!.tick);
    // the knocked victims need their slide plus a full stillness hold before
    // they go off — staged, never instant
    for (const s of [blasts[2]!, blasts[3]!]) {
      expect(s.tick - blasts[0]!.tick).toBeGreaterThan(SIM.BLAST_SETTLE_CONFIRM_TICKS);
    }
    expect(w.ducks).toHaveLength(0);
  });

  it('blasts damage barrels of any colour in radius', () => {
    const w = new World(1);
    // Straddles both pop points. Blast reach is pure centre distance (135), so
    // the barrel must sit inside both pop discs while staying clear of the lane
    // the ducks run down — a direct hit would damage it as well. The struck duck
    // is shot hard enough to rebound off the far wall and come most of the way
    // back inside its fuse, putting the two pop points ~107 apart at (288.8, 700)
    // and (396.1, 700); the barrel tucks under their midpoint, 115 below the lane
    // (clear of DUCK_R + BARREL_R = 106) and ~127 from each pop point.
    const barrel = w.spawnBarrel('wood', 342, 815, 3);
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('red', 393, 700);
    w.launch(a.id, 900, 0);
    record(w, 200);
    expect(barrel.hp).toBe(1); // one hit from each of the pair's two blasts
  });
});
