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
 * down, then pops and detonates. A blast relights a *fresh* fuse on the ducks it
 * catches, so every chain generation costs a further 90 ticks.
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

  it('a blast relights a fresh fuse: chains cost one fuse per generation', () => {
    const w = new World(1);
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('red', 393, 700);
    // third red parked well inside BLAST_R of where the pair goes off
    const c = w.spawnDuck('red', 380, 810);
    // green bystander in the same blast — colour still gates the chain
    const green = w.spawnDuck('green', 300, 810);
    w.launch(a.id, 140, 0);
    const log = record(w, 400);

    const chainMatch = log.filter((s) => s.e.type === 'duckMatched' && (s.e as { id: number }).id === c.id);
    expect(chainMatch).toHaveLength(1);
    const blasts = log.filter((s) => s.e.type === 'blast');
    // two from the pair (same tick), one from the duck the blast caught
    expect(blasts).toHaveLength(3);
    expect(blasts[0]!.tick).toBe(blasts[1]!.tick);
    // the chained duck was flagged by the pair's blast and burned a whole fuse
    expect(chainMatch[0]!.tick).toBe(blasts[0]!.tick);
    expect(blasts[2]!.tick - blasts[0]!.tick).toBe(FUSE);
    expect(w.ducks).toHaveLength(1);
    expect(w.ducks[0]!.id).toBe(green.id);
  });

  it('blasts damage barrels of any colour in radius', () => {
    const w = new World(1);
    // straddles both pop points: the struck duck drifts on for a full fuse
    // before it goes off, so it detonates well clear of the contact point
    const barrel = w.spawnBarrel('purple', 414, 850, 3);
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('red', 393, 700);
    w.launch(a.id, 140, 0);
    record(w, 200);
    expect(barrel.hp).toBe(1); // one hit from each of the pair's two blasts
  });
});
