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
 * confirmation period, never mid-slide. That stillness rule covers EVERY doomed
 * duck (user-locked 2026-08-06): a contact match burns its full fuse AND then
 * waits out its own motion, so a settled pair pops together while a duck still
 * sliding at fuse-end holds its blast until it rests.
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
    const log = record(w, 400);

    const matchTick = firstTick(log, 'duckMatched');
    expect(matchTick).toBeGreaterThanOrEqual(0);
    const pops = log.filter((s) => s.e.type === 'duckPopped');
    expect(pops).toHaveLength(2);
    // the knocked partner comes to rest well inside the fuse, so it keeps the
    // classic timing: exactly one full fuse after contact, not a tick sooner
    expect(pops[0]!.tick).toBe(matchTick + FUSE);
    // the shot itself is still riding its rebound when the fuse runs out — it
    // holds its blast until it has fully stopped and sat still (see the
    // 'never pops mid-glide' test for the exact hold)
    expect(pops[1]!.tick).toBeGreaterThan(matchTick + FUSE);
    // ~1.5s of blinking, and nothing popped a moment earlier
    expect(FUSE / 60).toBeGreaterThan(1.4);
    expect(FUSE / 60).toBeLessThan(1.6);
    expect(log.filter((s) => s.e.type === 'blast')).toHaveLength(2);
    expect(w.ducks).toHaveLength(0);
  });

  it('a doomed duck never pops mid-glide: full stop plus a stillness hold first', () => {
    const w = new World(1);
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('red', 460, 700);
    w.launch(a.id, 900, 0);
    // step by hand, tracking the launched duck's last tick in motion
    w.events.length = 0;
    let lastMove = -1;
    let popTick = -1;
    let matchTick = -1;
    for (let tick = 0; tick < 400 && popTick < 0; tick++) {
      w.step(SIM.DT);
      if (!a.popping && (a.vx !== 0 || a.vy !== 0)) lastMove = tick;
      for (const e of w.events.splice(0, w.events.length)) {
        if (e.type === 'duckMatched' && e.id === a.id) matchTick = tick;
        if (e.type === 'duckPopped' && e.id === a.id) popTick = tick;
      }
    }
    expect(matchTick).toBeGreaterThanOrEqual(0);
    expect(popTick).toBeGreaterThan(lastMove); // never mid-glide
    // the pause the player sees between the duck resting and the bang
    expect(popTick - lastMove).toBe(SIM.BLAST_SETTLE_CONFIRM_TICKS);
    // and the blink still ran its full course first
    expect(popTick).toBeGreaterThanOrEqual(matchTick + FUSE);
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
    // two from the pair, then one per caught duck as it settles. The pair's
    // pops stagger a few ticks apart here: the struck partner is still
    // finishing its knocked slide when the shooter's fuse runs out, and every
    // pop now waits for ITS duck to be fully at rest.
    expect(blasts).toHaveLength(4);
    expect(blasts[1]!.tick).toBeGreaterThanOrEqual(blasts[0]!.tick);
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
    // the ducks run down — a direct hit would damage it as well. Pops land at
    // each duck's REST position now (settle-gated), so the launch is kept just
    // over POP_SPEED: a harder shot shoves its partner too far for any barrel
    // spot to reach both rest points. The pair settles at (301.1, 700) and
    // (452.6, 700); the barrel tucks under their midpoint, 109 below the lane
    // (clear of DUCK_R + BARREL_R = 106) and ~133 from each pop point.
    const barrel = w.spawnBarrel('wood', 377, 809, 3);
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('red', 393, 700);
    w.launch(a.id, 132, 0);
    record(w, 400);
    expect(barrel.hp).toBe(1); // one hit from each of the pair's two blasts
  });
});
