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
 * waits out its own motion.
 *
 * Readiness is per duck; the POP is not (user-locked 2026-08-07). The whole
 * doomed set is held until its slowest member is ready and then goes off on one
 * frame — one bang per chain generation, never a drum roll. The next generation
 * is whatever that bang dooms, and it detonates together in turn.
 *
 * The fuse is decremented on the same tick it is lit, exactly as the official's
 * tick() does (its fuse pass runs after contact resolution) — so a duck reads
 * MATCH_FUSE_TICKS - 1 on the first tick you can observe it, and pops
 * MATCH_FUSE_TICKS - 1 ticks later.
 */
const FUSE = SIM.MATCH_FUSE_TICKS - 1;

/**
 * Set a duck moving WITHOUT it being a player's shot.
 *
 * The close-quarters tests below place their bystanders and barrels against
 * measured pop points, which needs the struck duck to travel a known short
 * distance — so they nudge the pair together at ~140px/s. `launch()` cannot
 * express that any more: the first duck a player's shot reaches leaves at
 * SIM.SHOT_STRIKE_SPEED whatever the approach (see tests/sim/strike.test.ts),
 * which is the whole point of that rule and would throw the partner clear
 * across the tub. A knock is the honest setup regardless — what these tests are
 * about is blast geometry, not the slingshot.
 *
 * `live` is set by hand because a match needs one live duck (onDuckContact),
 * and it is exactly what a blast does to the ducks it shoves.
 */
const knock = (d: { live: boolean; vx: number; vy: number }, vx: number, vy = 0): void => {
  d.live = true;
  d.vx = vx;
  d.vy = vy;
};

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

  it('each of the pair pops on its OWN settle, a full fuse after contact', () => {
    const w = new World(1);
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('red', 460, 700);
    w.launch(a.id, 900, 0);
    const log = record(w, 400);

    const matchTick = firstTick(log, 'duckMatched');
    expect(matchTick).toBeGreaterThanOrEqual(0);
    const pops = log.filter((s) => s.e.type === 'duckPopped');
    expect(pops).toHaveLength(2);
    // TWO frames, not one (user-locked 2026-08-08). The knocked partner is at
    // rest well inside the fuse and goes as soon as its fuse runs out; the shot
    // is still riding its rebound and goes whenever it finally stops. Nothing
    // waits for anything else, so the two are genuinely apart.
    expect(pops[1]!.tick).toBeGreaterThan(pops[0]!.tick);
    // …and each still owes the full fuse from the contact that lit it. The
    // partner is knocked clear and already at rest, so it goes on the exact
    // frame its fuse expires — the earliest a contact match may ever pop.
    expect(pops[0]!.tick).toBeGreaterThanOrEqual(matchTick + FUSE);
    // The fuse is AD-PACED (0.60s), not the official's 1.5s — see the note on
    // SIM.MATCH_FUSE_TICKS. Both ends of this band are load-bearing. The floor
    // is readability: a fuse the eye cannot catch turns the pop into an
    // unexplained disappearance. The ceiling is the ad itself, and it is the
    // tighter constraint of the two, because the fuse is paid once per chain
    // GENERATION — every 0.1s here is half a second on a five-deep chain.
    expect(FUSE / 60).toBeGreaterThan(0.5);
    expect(FUSE / 60).toBeLessThan(0.7);
    // …and what actually reads as "lit" is the number of alternations, not the
    // duration. The two constants have to be retuned together; this is the tie.
    expect(SIM.MATCH_FUSE_TICKS / SIM.MATCH_BLINK_TICKS).toBeGreaterThanOrEqual(3);
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
    knock(a, 140);
    const log = record(w, 600);

    const chainMatch = log.filter((s) => s.e.type === 'duckMatched' && (s.e as { id: number }).id === c.id);
    expect(chainMatch).toHaveLength(1);
    const blasts = log.filter((s) => s.e.type === 'blast');
    // FOUR BANGS, EACH ON ITS OWN CLOCK (user-locked 2026-08-08). Every duck
    // goes off when it personally settles, so the four are strictly ordered in
    // time rather than paired into two generation-wide frames.
    expect(blasts).toHaveLength(4);
    expect(blasts.map((b) => b.tick)).toEqual([...blasts.map((b) => b.tick)].sort((x, y) => x - y));
    // the chain is still a chain: the two bystanders are doomed by the pair's
    // first blast, and cannot go off before it
    expect(chainMatch[0]!.tick).toBe(blasts[0]!.tick);
    expect(blasts[3]!.tick).toBeGreaterThan(blasts[0]!.tick);
    // and a victim still needs its slide plus a full stillness hold — the pop is
    // staged behind the stop, never instant on the knock
    expect(blasts[3]!.tick - blasts[0]!.tick).toBeGreaterThan(SIM.BLAST_SETTLE_CONFIRM_TICKS);
    expect(w.ducks).toHaveLength(0);
  });

  it('a blast that catches a crowd lets each of them go off as it settles', () => {
    const w = new World(1);
    // a red pair to start the chain, ringed by four bystanders parked at
    // different distances from the pop point so their knocked slides — and so
    // their individual settle times — genuinely differ
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('red', 393, 700);
    for (const [x, y] of [[250, 800], [360, 810], [230, 620], [355, 600]]) {
      w.spawnDuck('green', x!, y!);
    }
    // just over POP_SPEED, so the pair goes off near where it started and the
    // ring is inside BLAST_R of the pop point (same geometry as the test above)
    knock(a, 140);
    const log = record(w, 900);

    const pops = log.filter((s) => s.e.type === 'duckPopped');
    expect(pops).toHaveLength(6);
    expect(w.ducks).toHaveLength(0);
    // THE POINT OF THE CHANGE (user-locked 2026-08-08). The four bystanders are
    // parked at deliberately different distances from the pop point, so their
    // knocked slides — and therefore their settle times — genuinely differ. They
    // used to be held to the slowest of them and go off on one frame; now each
    // goes as it stops, so the crowd spreads across several frames.
    // by COLOUR, not by frame: the red pair no longer shares a tick either, so
    // "everything after the first pop" would sweep one of them in as well
    const crowd = pops.filter((s) => (s.e as { colour: string }).colour === 'green');
    expect(crowd).toHaveLength(4);
    expect(new Set(crowd.map((s) => s.tick)).size).toBeGreaterThan(1);
    // nobody waits on anybody: the first of the crowd goes off strictly before
    // the last of it, which is the beat the old rule flattened away
    expect(crowd[3]!.tick).toBeGreaterThan(crowd[0]!.tick);
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
    knock(a, 132);
    record(w, 400);
    expect(barrel.hp).toBe(1); // one hit from each of the pair's two blasts
  });
});
