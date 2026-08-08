import { describe, expect, it } from 'vitest';
import { Slingshot } from '../../src/sim/aim';
import { SIM } from '../../src/sim/config';
import { predictShot } from '../../src/sim/trajectory';
import { World } from '../../src/sim/world';
import type { SimEvent } from '../../src/sim/types';

/**
 * The clam (the pack's oyster rig) is a repeatable PEARL DISPENSER. Rules:
 *   1. it is ALWAYS solid — shut, open or spent it bounces ducks, because the
 *      rig is the game's bumper, and that deflection is level geometry;
 *   2. ANY duck CONTACT with an armed shell runs the routine: open -> spill a
 *      pearl -> pearl reaches the HUD -> shell shuts. Direction and strength do
 *      not gate the payout: if a duck reached it, it pays. A POP within BLAST_R
 *      runs the same routine, on the same terms as a crate taking the blast;
 *   3. EVERY contact, including one landing mid-cycle, which restarts the shell
 *      and spills a pearl of its own. The only thing counted once is a single
 *      physical collision seen twice across the adaptive substeps;
 *   4. once the level's quota is met the Director spends every clam: still
 *      solid, still visible, permanently inert.
 *
 * Distances are written against the contact radius DUCK_R + CLAM_R = 102 rather
 * than literals, so a config retune moves the tests with it.
 */
const TOUCH = SIM.DUCK_R + SIM.CLAM_R;
const CLAM = { x: 360, y: 700 };
/** far enough left of the clam to build up speed, clear of the tub wall (x >= 92) */
const LANE_X = 150;
/** the tick the pearl lands on the counter, measured from the IMPACT */
const COLLECT_AT = SIM.PEARL_FLIGHT_TICKS;

const steps = (w: World, n: number): void => {
  for (let i = 0; i < n; i++) w.step(SIM.DT);
};
/**
 * Step until the named event fires, then stop — the duck's post-bounce state has
 * to be read on the contact tick. Drag kills a slow rebound in ~10 ticks and a
 * fast one is back off the far wall inside 20, so "run 30 ticks then look" reads
 * the wrong moment entirely.
 */
const stepUntil = (w: World, type: SimEvent['type'], maxTicks = 240): number => {
  for (let i = 0; i < maxTicks; i++) {
    w.step(SIM.DT);
    if (w.events.some((e) => e.type === type)) return i;
  }
  return -1;
};
const only = (evs: SimEvent[], type: SimEvent['type']): SimEvent[] =>
  evs.filter((e) => e.type === type);

describe('clam — a solid bumper that dispenses pearls', () => {
  it('a SLOW duck bounces back and still spills its pearl', () => {
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    // parked 8px outside contact so the approach speed at impact is the one we
    // set: a feeble 100 px/s, which used to be under the crack threshold and
    // bounced off a shell that visibly reacted and paid nothing
    const d = w.spawnDuck('red', CLAM.x - TOUCH - 8, CLAM.y);
    d.vx = 100;
    w.events.length = 0;

    expect(stepUntil(w, 'bumperHit', 30)).toBeGreaterThanOrEqual(0);

    expect(c.open).toBe(true);
    expect(only(w.events, 'clamOpened')).toHaveLength(1);
    expect(only(w.events, 'pearlReleased')).toHaveLength(1);
    // and it still bounces: the deflection is level geometry, untouched
    expect(only(w.events, 'bumperHit').length).toBeGreaterThan(0);
    expect(d.vx).toBeLessThan(0);
    expect(Math.hypot(d.x - c.x, d.y - c.y)).toBeGreaterThanOrEqual(TOUCH - 1e-6);
  });

  it('a fast duck that rebounds and comes back is paid for BOTH contacts', () => {
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    const d = w.spawnDuck('red', LANE_X, CLAM.y);
    w.launch(d.id, SIM.LAUNCH_SPEED, 0);
    w.events.length = 0;

    // the shot hits, rebounds off the far wall and comes back for a second and
    // third contact — all inside ONE cycle, and every one of them pays
    steps(w, SIM.CLAM_CYCLE_TICKS - 1);

    expect(c.open).toBe(true);
    const opened = only(w.events, 'clamOpened');
    expect(opened.length).toBeGreaterThan(1);
    expect(opened[0]).toEqual({ type: 'clamOpened', id: c.id, x: c.x, y: c.y });
    // one pearl per opening, each with its own id so the view can tell them apart
    const spilled = only(w.events, 'pearlReleased');
    expect(spilled).toHaveLength(opened.length);
    expect(new Set(spilled.map((e) => (e as { pearl: number }).pearl)).size).toBe(spilled.length);
  });

  it('a GLANCING hit spills its pearl — direction does not gate the payout', () => {
    // The regression test for the reported bug. A duck slides past the clam's
    // face at 900 px/s but only grazes it: the lane is half a pixel inside
    // contact range, so the deepest normal component is ~68 px/s however the
    // substeps land. That is the shape of every "it reacted but nothing came
    // out" report — fast duck, shallow normal. It bounced and stayed shut
    // because the payout was gated on the NORMAL component while the react was
    // not. One contact, one pearl.
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    const d = w.spawnDuck('red', LANE_X, CLAM.y - (TOUCH - 0.5));
    d.vx = 900;
    w.events.length = 0;

    expect(stepUntil(w, 'bumperHit', 40)).toBeGreaterThanOrEqual(0);

    expect(c.open).toBe(true);
    expect(only(w.events, 'pearlReleased')).toHaveLength(1);
  });

  it('a blast inside BLAST_R opens it and spills one pearl', () => {
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    // stood clear of contact, so anything that happens is the blast and not a touch
    const d = w.spawnDuck('red', CLAM.x, CLAM.y + SIM.BLAST_R - 5);
    expect(Math.hypot(d.x - c.x, d.y - c.y)).toBeGreaterThan(SIM.DUCK_R + SIM.CLAM_R);
    w.events.length = 0;
    w.popDuck(d); // pops where it stands and detonates

    expect(c.open).toBe(true);
    expect(only(w.events, 'clamOpened')).toHaveLength(1);
    // exactly one, the same as a duck landing on it — not one per substep
    expect(only(w.events, 'pearlReleased')).toHaveLength(1);
  });

  it('one detonation pays each caught shell exactly once', () => {
    const w = new World(1);
    const a = w.spawnClam(CLAM.x - 120, CLAM.y);
    const b = w.spawnClam(CLAM.x + 120, CLAM.y);
    const d = w.spawnDuck('red', CLAM.x, CLAM.y);
    w.events.length = 0;
    w.popDuck(d);

    expect(a.open).toBe(true);
    expect(b.open).toBe(true);
    // two shells caught, two pearls — and the fixed steps that follow add none
    expect(only(w.events, 'pearlReleased')).toHaveLength(2);
    w.events.length = 0;
    for (let i = 0; i < 30; i++) w.step(SIM.DT);
    expect(only(w.events, 'pearlReleased')).toHaveLength(0);
  });

  it('a blast outside BLAST_R leaves it shut', () => {
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    const d = w.spawnDuck('red', CLAM.x, CLAM.y + SIM.BLAST_R + 5);
    w.events.length = 0;
    w.popDuck(d);

    expect(c.open).toBe(false);
    expect(only(w.events, 'clamOpened')).toHaveLength(0);
  });

  it('the blast reach against a shell is BLAST_R exactly', () => {
    // walks out from contact to just past the rim; every sample is clear of
    // touching, so anything that opens here opened on the blast
    const cases: Array<[number, boolean]> = [
      [SIM.DUCK_R + SIM.CLAM_R + 2, true],
      [120, true],
      [SIM.BLAST_R - 1, true],
      [SIM.BLAST_R, true],
      [SIM.BLAST_R + 1, false],
    ];
    for (const [gap, opens] of cases) {
      const w = new World(1);
      const c = w.spawnClam(CLAM.x, CLAM.y);
      const d = w.spawnDuck('red', CLAM.x, CLAM.y + gap);
      expect(Math.hypot(d.x - c.x, d.y - c.y), `gap ${gap}`)
        .toBeGreaterThan(SIM.DUCK_R + SIM.CLAM_R);
      w.events.length = 0;
      w.popDuck(d);
      expect(c.open, `gap ${gap}`).toBe(opens);
      expect(only(w.events, 'pearlReleased'), `gap ${gap}`).toHaveLength(opens ? 1 : 0);
    }
  });

  // ── the cycle ─────────────────────────────────────────────────────────────

  it('the impact is ONE frame: open and pearl land on the same tick', () => {
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    w.events.length = 0;
    w.hitClam(c);

    // no stepping at all — both are already out, in order, before any tick runs
    expect(w.events).toEqual([
      { type: 'clamOpened', id: c.id, x: c.x, y: c.y },
      { type: 'pearlReleased', id: c.id, pearl: w.pearls[0]!.id, x: c.x, y: c.y },
    ]);
  });

  it('a duck hit spills the pearl on the CONTACT tick, not a beat later', () => {
    // the end-to-end version of the above: the pearl must not lag the bounce
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    const d = w.spawnDuck('red', LANE_X, CLAM.y);
    w.launch(d.id, SIM.LAUNCH_SPEED, 0);
    w.events.length = 0;

    for (let i = 0; i < 240; i++) {
      w.step(SIM.DT);
      const opened = w.events.some((e) => e.type === 'clamOpened');
      if (opened) {
        // same drain: the bounce, the opening and the spill are one event batch
        expect(w.events.some((e) => e.type === 'bumperHit')).toBe(true);
        expect(w.events.some((e) => e.type === 'pearlReleased')).toBe(true);
        return;
      }
      w.events.length = 0;
    }
    throw new Error('the clam never opened');
  });

  it('runs the rest of the cycle on the tick counts the view animates against', () => {
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    w.hitClam(c);
    w.events.length = 0;

    // the pearl flies to the counter, and only on arrival is it counted
    steps(w, COLLECT_AT - 1);
    expect(only(w.events, 'pearlCollected')).toHaveLength(0);
    steps(w, 1);
    expect(only(w.events, 'pearlCollected')).toHaveLength(1);

    // …and the shell is still open until the cycle ends
    steps(w, SIM.CLAM_CYCLE_TICKS - COLLECT_AT - 1);
    expect(c.open).toBe(true);
    expect(only(w.events, 'clamClosed')).toHaveLength(0);
    steps(w, 1);
    expect(c.open).toBe(false);
    expect(only(w.events, 'clamClosed')).toEqual([{ type: 'clamClosed', id: c.id }]);
  });

  it('the cycle outlasts the rig\'s 0.30s opening plus a beat of idle', () => {
    // `bump` re-attaches the lid for most of its run and strips it at 0.30s. If
    // the shell shut before that finished, the clam would snap back to dormant
    // mid-open and the opening would never be seen.
    expect(SIM.CLAM_CYCLE_TICKS * SIM.DT).toBeGreaterThan(0.30);
    // and the pearl must be collected before the shell shuts under it
    expect(SIM.PEARL_FLIGHT_TICKS).toBeLessThan(SIM.CLAM_CYCLE_TICKS);
  });

  it('flings a duck far harder than a barrel would', () => {
    // the oyster is the game's pinball bumper, not a wall: a head-on slam comes
    // back near the speed it arrived, where RESTITUTION_STATIC would halve it
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    const d = w.spawnDuck('red', CLAM.x - TOUCH - 4, CLAM.y);
    d.vx = 1200;
    w.events.length = 0;

    expect(stepUntil(w, 'bumperHit', 30)).toBeGreaterThanOrEqual(0);

    expect(d.vx).toBeLessThan(0);                                  // came back
    expect(Math.abs(d.vx)).toBeGreaterThan(1200 * SIM.RESTITUTION_STATIC);
    expect(Math.abs(d.vx)).toBeGreaterThan(SIM.CLAM_KICK);
    expect(Math.hypot(d.vx, d.vy)).toBeLessThanOrEqual(SIM.MAX_SPEED);
  });

  it('the fling never lets a duck escape the speed cap', () => {
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    const d = w.spawnDuck('red', CLAM.x - TOUCH - 4, CLAM.y);
    d.vx = SIM.MAX_SPEED;
    w.events.length = 0;
    expect(stepUntil(w, 'bumperHit', 30)).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(d.vx, d.vy)).toBeLessThanOrEqual(SIM.MAX_SPEED + 1e-6);
  });

  it('every approach speed yields exactly one pearl, never zero and never two', () => {
    // sweeps the whole range the old threshold cut across, plus a crawl and a
    // slam either side of it: the payout is one per contact throughout
    for (const speed of [80, 106, 126, 146, 400, 1200]) {
      const w = new World(1);
      const c = w.spawnClam(CLAM.x, CLAM.y);
      const d = w.spawnDuck('red', CLAM.x - TOUCH - 8, CLAM.y);
      d.vx = speed;
      w.events.length = 0;
      expect(stepUntil(w, 'bumperHit', 60), `speed ${speed}`).toBeGreaterThanOrEqual(0);
      expect(c.open, `speed ${speed}`).toBe(true);
      expect(only(w.events, 'pearlReleased'), `speed ${speed}`).toHaveLength(1);
    }
  });

  it('re-arms after the cycle and yields a SECOND pearl when hit again', () => {
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    w.hitClam(c);
    steps(w, SIM.CLAM_CYCLE_TICKS);
    expect(c.open).toBe(false);
    w.events.length = 0;

    w.hitClam(c); // armed again
    expect(only(w.events, 'clamOpened')).toHaveLength(1);
    steps(w, SIM.CLAM_CYCLE_TICKS);
    expect(only(w.events, 'pearlReleased')).toHaveLength(1);
    expect(only(w.events, 'pearlCollected')).toHaveLength(1);
  });

  it('each pearl flies on its OWN clock, not the shell\'s cycle', () => {
    // The bookkeeping half of "every hit pays". The pearl used to be collected
    // at cycleTicks == PEARL_FLIGHT_TICKS, so a second hit — which restarts the
    // cycle — would have stranded the first pearl: the view holds each one just
    // short of the counter until the sim says it landed, so a lost arrival is a
    // pearl hanging in the air for ever and a count that never drops.
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    const GAP = 20; // well inside the 60-tick cycle
    w.hitClam(c);
    steps(w, GAP);
    w.hitClam(c); // restarts the shell, spills a second pearl
    expect(w.pearls).toHaveLength(2);

    // `t` counts fixed steps since the FIRST hit, so the second pearl left at GAP
    const landed: number[] = [];
    for (let t = GAP + 1; t <= COLLECT_AT + GAP + 5; t++) {
      w.events.length = 0;
      steps(w, 1);
      if (only(w.events, 'pearlCollected').length > 0) landed.push(t);
    }
    // each lands COLLECT_AT ticks after ITS OWN release, so GAP apart
    expect(landed).toEqual([COLLECT_AT, COLLECT_AT + GAP]);
    expect(w.pearls).toHaveLength(0);
  });

  it('one physical collision spends one pearl, across every substep', () => {
    // adaptive substepping runs the clam collision up to 16x per fixed step, so
    // one slam can register as an approach twice inside a step. That — and only
    // that — is what the debounce is for, so the invariant is per STEP: however
    // many times a duck rebounds over the cycle, no single step ever pays twice.
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    const d = w.spawnDuck('red', LANE_X, CLAM.y);
    w.launch(d.id, SIM.LAUNCH_SPEED, 0);

    let total = 0;
    for (let t = 0; t < SIM.CLAM_CYCLE_TICKS * 3; t++) {
      w.events.length = 0;
      steps(w, 1);
      const opened = only(w.events, 'clamOpened').length;
      expect(opened, `step ${t}`).toBeLessThanOrEqual(1);
      total += opened;
    }
    expect(total).toBeGreaterThan(1); // it really did come back for more
  });

  it('a touch mid-cycle plays the routine AGAIN — the shell is never busy', () => {
    // The reported bug, measured: over 10 levels x 15 bot seeds, 48.2% of all
    // 5245 physical duck->shell contacts produced no routine at all, and 2523 of
    // those 2526 silent contacts were refused by this one gate — the shell was
    // still inside the 60-tick cycle a previous hit started. Half were a
    // DIFFERENT duck (1280 of 2523). The duck was flung and the sound played;
    // the mouth never opened and no pearl came out.
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    w.hitClam(c);          // a cycle is already running…
    steps(w, 10);          // …and ten ticks into it, well short of the 60
    expect(c.open).toBe(true);
    // the softest touch there is: parked just outside contact at 100 px/s
    const d = w.spawnDuck('red', CLAM.x - TOUCH - 8, CLAM.y);
    d.vx = 100;
    w.events.length = 0;

    expect(stepUntil(w, 'bumperHit', 30)).toBeGreaterThanOrEqual(0);

    expect(only(w.events, 'clamOpened')).toHaveLength(1);
    expect(only(w.events, 'pearlReleased')).toHaveLength(1);
  });

  it('a spent clam stops dispensing but stays solid', () => {
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    w.spendClams();
    expect(c.active).toBe(false);

    const d = w.spawnDuck('red', LANE_X, CLAM.y);
    w.launch(d.id, SIM.LAUNCH_SPEED, 0);
    w.events.length = 0;
    expect(stepUntil(w, 'bumperHit', 60)).toBeGreaterThanOrEqual(0);

    // no pearls, ever again…
    steps(w, SIM.CLAM_CYCLE_TICKS);
    expect(only(w.events, 'clamOpened')).toHaveLength(0);
    expect(only(w.events, 'pearlReleased')).toHaveLength(0);
    expect(c.open).toBe(false);
    // …but it still bounced, and it is still on the board
    expect(only(w.events, 'bumperHit').length).toBeGreaterThan(0);
    expect(w.clams).toContain(c);
  });

  it('a blast cannot revive a spent clam', () => {
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    w.spendClams();
    w.events.length = 0;
    w.popDuck(w.spawnDuck('red', CLAM.x, CLAM.y + SIM.BLAST_R - 5));

    expect(c.open).toBe(false);
    expect(only(w.events, 'clamOpened')).toHaveLength(0);
  });

  it('an open clam is still solid — it keeps bouncing ducks', () => {
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    w.hitClam(c);
    const d = w.spawnDuck('red', LANE_X, CLAM.y);
    w.launch(d.id, SIM.LAUNCH_SPEED, 0);
    w.events.length = 0;

    expect(stepUntil(w, 'bumperHit', 60)).toBeGreaterThanOrEqual(0);

    expect(only(w.events, 'bumperHit').length).toBeGreaterThan(0);
    expect(d.vx).toBeLessThan(0);                  // came back
    expect(d.x).toBeLessThan(c.x - SIM.DUCK_R);    // did not tunnel through
    expect(Math.hypot(d.x - c.x, d.y - c.y)).toBeGreaterThanOrEqual(TOUCH - 1e-6);
  });

  it('a clam never blocks a duck out of the world: separation is exact', () => {
    const w = new World(1);
    const c = w.spawnClam(CLAM.x, CLAM.y);
    // start it overlapping and let the solver push it out
    const d = w.spawnDuck('yellow', CLAM.x + 10, CLAM.y + 10);
    steps(w, 5);
    expect(Math.hypot(d.x - c.x, d.y - c.y)).toBeCloseTo(TOUCH, 6);
  });

  it('the aim guide treats a clam as a blocker and the release is refused', () => {
    const w = new World(1);
    const shooter = w.spawnDuck('red', 150, 700);
    const clam = w.spawnClam(360, 700);
    const target = w.spawnDuck('yellow', 620, 700); // squarely behind the clam

    const pv = predictShot(w, shooter, { x: 1, y: 0 });
    expect(pv.hitKind).toBe('clam');
    expect(pv.hitId).toBe(clam.id);
    expect(pv.hitId).not.toBe(target.id);
    expect(pv.deflect).toBeNull();          // only a duck hit has a deflection
    expect(pv.points).toHaveLength(2);      // stopped on the clam, no bounce leg

    const sling = new Slingshot(w);
    sling.assist = 0;                       // aim exactly where we point it
    expect(sling.begin(shooter.x, shooter.y)).toBe(true);
    sling.move(shooter.x - 150, shooter.y); // pull back left => fire right
    expect(sling.preview()?.hitKind).toBe('clam');
    w.events.length = 0;
    expect(sling.end()).toBe(false);
    expect(only(w.events, 'duckLaunched')).toHaveLength(0);
    expect(shooter.live).toBe(false);
    expect(sling.aiming).toBe(false);        // the grab let go, as on a red X
  });

  it('an OPEN clam blocks the guide too — it is a bumper for good', () => {
    const w = new World(1);
    const shooter = w.spawnDuck('red', 150, 700);
    const clam = w.spawnClam(360, 700);
    w.hitClam(clam);
    w.spawnDuck('yellow', 620, 700);

    const pv = predictShot(w, shooter, { x: 1, y: 0 });
    expect(pv.hitKind).toBe('clam');
    expect(pv.hitId).toBe(clam.id);
  });

  it('a SPENT clam blocks the guide too — inert is not intangible', () => {
    const w = new World(1);
    const shooter = w.spawnDuck('red', 150, 700);
    const clam = w.spawnClam(360, 700);
    w.spendClams();
    w.spawnDuck('yellow', 620, 700);

    const pv = predictShot(w, shooter, { x: 1, y: 0 });
    expect(pv.hitKind).toBe('clam');
    expect(pv.hitId).toBe(clam.id);
  });

  it('a clear lane past a clam still locks the duck behind it', () => {
    const w = new World(1);
    const shooter = w.spawnDuck('red', 150, 700);
    w.spawnClam(360, 700);
    // the target sits off the clam's lane; aim straight at it and the guide is happy
    const target = w.spawnDuck('yellow', 620, 350);
    const dx = target.x - shooter.x, dy = target.y - shooter.y;
    const len = Math.hypot(dx, dy);
    const pv = predictShot(w, shooter, { x: dx / len, y: dy / len });

    expect(pv.hitKind).toBe('duck');
    expect(pv.hitId).toBe(target.id);
  });

  it('spawnClam announces itself, shut and armed, with the requested skin', () => {
    const w = new World(1);
    const c = w.spawnClam(200, 400, 'gold');
    expect(c).toMatchObject({
      kind: 'clam', x: 200, y: 400, skin: 'gold',
      open: false, active: true, cycleTicks: 0,
    });
    expect(only(w.events, 'clamSpawned')).toEqual([{ type: 'clamSpawned', clam: c }]);
    expect(w.spawnClam(300, 400).skin).toBe('normal'); // default
    expect(w.clams).toHaveLength(2);
  });
});
