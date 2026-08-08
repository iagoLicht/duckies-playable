import { describe, expect, it } from 'vitest';
import { SIM } from '../../src/sim/config';
import { World } from '../../src/sim/world';

const mk = (): World => new World(42);

describe('World motion', () => {
  it('a launched duck slows down and eventually stops (friction)', () => {
    const w = mk();
    const d = w.spawnDuck('red', 360, 700);
    w.launch(d.id, 800, 0);
    expect(d.live).toBe(true);
    for (let i = 0; i < 60 * 6; i++) w.step(SIM.DT);
    expect(Math.hypot(d.vx, d.vy)).toBe(0);
    expect(d.live).toBe(false);
  });

  it('bounces off the right wall and reverses vx', () => {
    const w = mk();
    const d = w.spawnDuck('red', 600, 700);
    w.launch(d.id, 1200, 0);
    for (let i = 0; i < 30; i++) w.step(SIM.DT);
    expect(d.vx).toBeLessThan(0);
    expect(d.x).toBeLessThan(694 - 20);
  });

  it('two different-colour ducks bounce apart without popping', () => {
    const w = mk();
    const a = w.spawnDuck('red', 300, 700);
    const b = w.spawnDuck('green', 460, 700);
    w.launch(a.id, 900, 0);
    let transferred = false;
    for (let i = 0; i < 90; i++) { w.step(SIM.DT); if (b.vx > 0) transferred = true; }
    expect(w.ducks).toHaveLength(2);
    expect(transferred).toBe(true); // momentum transferred
  });

  it('wall kick: tangential speed survives, normal exit is a share of TOTAL speed', () => {
    const w = mk();
    const d = w.spawnDuck('red', 630, 700); // just past the right-wall centre limit (628)
    d.vx = 100;
    d.vy = -800; // grazing the wall, mostly upward
    w.step(SIM.DT);
    // official Yr: exit normal speed = 0.93·|v| even on a graze —
    // a mirror bounce would only return the tiny 100 px/s
    expect(d.vx).toBeLessThan(-600);
    expect(d.vy).toBeLessThan(-700); // upward tangential kept
  });

  it('a slow duck is never absorbed: the minimum wall kick applies', () => {
    const w = mk();
    const d = w.spawnDuck('red', 630, 700);
    d.vx = 45;
    w.step(SIM.DT);
    expect(d.vx).toBeLessThan(-100); // WALL_MIN_KICK, not 0.93·45
  });

  it('wall contact emits a wallHit event with the outward normal', () => {
    const w = mk();
    const d = w.spawnDuck('red', 630, 700);
    d.vx = 200;
    w.step(SIM.DT);
    const hits = w.events.filter((e) => e.type === 'wallHit');
    expect(hits.length).toBeGreaterThan(0);
    const h = hits[0]!;
    if (h.type !== 'wallHit') throw new Error('unreachable');
    expect(h.nx).toBeLessThan(-0.9); // right wall pushes left
    expect(h.source).toBe('wall');
  });

  it('the wall kick is capped at MAX_SPEED', () => {
    const w = mk();
    const d = w.spawnDuck('red', 630, 700);
    d.vx = 6000;
    w.step(SIM.DT);
    expect(Math.hypot(d.vx, d.vy)).toBeLessThanOrEqual(SIM.MAX_SPEED + 1);
  });

  it('a fresh shot flies with low drag until its first contact', () => {
    const w = mk();
    const d = w.spawnDuck('red', 360, 1100);
    w.launch(d.id, 0, -SIM.LAUNCH_SPEED);
    for (let i = 0; i < 15; i++) w.step(SIM.DT); // 0.25 s, nothing to hit yet
    expect(Math.hypot(d.vx, d.vy)).toBeGreaterThan(SIM.LAUNCH_SPEED * 0.85);
  });

  it('after the first contact, drag jumps and the shot dies down fast', () => {
    const w = mk();
    const d = w.spawnDuck('red', 360, 1100);
    w.launch(d.id, 0, SIM.LAUNCH_SPEED); // straight into the bottom wall
    for (let i = 0; i < 30; i++) w.step(SIM.DT); // bounce, then 0.45 s of contact drag
    const speed = Math.hypot(d.vx, d.vy);
    expect(speed).toBeLessThan(1500); // flight drag alone would leave ~2300
    expect(speed).toBeGreaterThan(500); // but it is still moving — walls kick, not absorb
  });

  it('duck hitting a barrel bounces back and damages it', () => {
    const w = mk();
    const barrel = w.spawnBarrel('wood', 500, 700, 2);
    const d = w.spawnDuck('red', 300, 700);
    w.launch(d.id, 1000, 0);
    // window ends after the rebound but before the duck can return off the wall
    // for a second contact (post-contact drag kills the rebound well short of it)
    for (let i = 0; i < 30; i++) w.step(SIM.DT);
    expect(barrel.hp).toBe(1);
    expect(d.vx).toBeLessThan(0); // bounced back
    expect(d.x).toBeLessThan(500 - 46); // did not tunnel through
    const evs = w.events.filter((e) => e.type === 'barrelDamaged');
    expect(evs).toHaveLength(1);
  });

  it('a direct hit removes exactly one stage — every duck colour', () => {
    for (const colour of ['yellow', 'green', 'purple', 'red'] as const) {
      const w = mk();
      const barrel = w.spawnBarrel('wood', 500, 700, 3);
      const d = w.spawnDuck(colour, 300, 700);
      w.launch(d.id, 1000, 0);
      for (let i = 0; i < 30; i++) w.step(SIM.DT);
      expect(barrel.hp).toBe(2); // one stage, no skips
      const hits = w.events.filter((e) => e.type === 'barrelDamaged');
      expect(hits).toHaveLength(1); // one collision = one stage, never more
    }
  });

  it('a duck KNOCKED into a barrel damages it too (not just the shot)', () => {
    const w = mk();
    const barrel = w.spawnBarrel('wood', 560, 700, 3);
    const knocked = w.spawnDuck('green', 400, 700); // never launched
    const shooter = w.spawnDuck('red', 300, 700);
    w.launch(shooter.id, 1200, 0);
    for (let i = 0; i < 30; i++) w.step(SIM.DT);
    expect(knocked.live).toBe(false); // it was never the shot
    expect(barrel.hp).toBe(2);
  });

  it('a nearby explosion removes exactly one stage — every duck colour', () => {
    for (const colour of ['yellow', 'green', 'purple', 'red'] as const) {
      const w = mk();
      const barrel = w.spawnBarrel('wood', 360, 815, 3); // 115 < BLAST_R of the pop
      const d = w.spawnDuck(colour, 360, 700);
      w.popDuck(d);
      expect(barrel.hp).toBe(2);
      const hits = w.events.filter((e) => e.type === 'barrelDamaged');
      expect(hits).toHaveLength(1);
    }
  });

  it('mixed damage sources step hp down exactly one at a time, never skipping', () => {
    const w = mk();
    const barrel = w.spawnBarrel('wood', 360, 815, 3); // two straps
    // 1: nearby explosion (yellow duck) -> one strap
    w.popDuck(w.spawnDuck('yellow', 360, 700));
    expect(barrel.hp).toBe(2);
    // 2: direct hit (purple duck, different colour) -> no straps
    const d = w.spawnDuck('purple', 360, 500);
    w.launch(d.id, 0, 1000);
    for (let i = 0; i < 30 && barrel.hp === 2; i++) w.step(SIM.DT);
    expect(barrel.hp).toBe(1);
    // 3: another explosion -> destroyed and gone
    w.popDuck(w.spawnDuck('green', 360, 930));
    expect(barrel.hp).toBe(0);
    expect(w.barrels).toHaveLength(0);
    // the event stream saw each stage exactly once, in order
    const hps = w.events.filter((e) => e.type === 'barrelDamaged')
      .map((e) => (e as { hp: number }).hp);
    expect(hps).toEqual([2, 1]);
    expect(w.events.filter((e) => e.type === 'barrelDestroyed')).toHaveLength(1);
  });

  /**
   * EVERY CONTACT COSTS A STAGE (user-locked 2026-08-07). There is no speed bar
   * on the damage any more — a touch is a touch. The cases below are the three
   * the old bar used to swallow.
   */
  it('a slow drifting duck damages a barrel — a touch is a touch', () => {
    const w = mk();
    const barrel = w.spawnBarrel('wood', 420, 700, 2);
    const d = w.spawnDuck('red', 320, 700);
    d.vx = 60; // a soft drift, never launched — under the old 90px/s bar
    for (let i = 0; i < 120; i++) w.step(SIM.DT);
    expect(barrel.hp).toBe(1);
  });

  it('EVERY contact costs a stage, across the whole head-on..grazing sweep', () => {
    // The old bar tested `vn`, the NORMAL component — so a duck arriving fast
    // but shallow carried most of its speed tangentially, cleared no bar, and
    // bounced off a crate it did not scratch. Sweep the approach line from dead
    // centre out to a graze and assert the invariant directly: if the crate
    // reported the touch, the crate lost a stage.
    const minD = SIM.DUCK_R + SIM.BARREL_R;
    const silent: string[] = [];
    let contacts = 0;
    for (let i = 0; i <= 20; i++) {
      const offset = (i / 20) * minD * 0.995;
      for (const speed of [60, 200, 700, 1400]) {
        const w = mk();
        const barrel = w.spawnBarrel('wood', 500, 700, 3);
        const d = w.spawnDuck('red', 300, 700 - offset);
        d.vx = speed;
        d.live = true;
        for (let s = 0; s < 60; s++) w.step(SIM.DT);
        const touched = w.events.some((e) => e.type === 'barrelBumped');
        if (!touched) continue;
        contacts++;
        if (barrel.hp === 3) silent.push(`offset ${Math.round(offset)} @ ${speed}px/s`);
      }
    }
    expect(contacts).toBeGreaterThan(20); // the sweep has to actually connect
    expect(silent).toEqual([]);
  });

  it('a resting duck already touching a barrel never nibbles it', () => {
    // the floor is STOP_SPEED, not a damage bar: the step snaps anything slower
    // than that to exactly zero, so a duck at rest against a crate has vn == 0
    // and is not approaching at all
    const w = mk();
    const barrel = w.spawnBarrel('wood', 420, 700, 3);
    const d = w.spawnDuck('red', 420 - (SIM.DUCK_R + SIM.BARREL_R) + 2, 700);
    d.vx = 0;
    d.vy = 0;
    for (let i = 0; i < 240; i++) w.step(SIM.DT);
    expect(barrel.hp).toBe(3);
  });
});

/**
 * A CRATE THAT IS TOUCHED ALWAYS FLINCHES.
 *
 * The crate's little bounce used to be driven by `barrelDamaged`, so it only
 * played when the contact ALSO chipped a stage — which at the time needed `vn`
 * past a 90px/s bar and the crate's damage cooldown clear. Measured across the
 * campaign (shots/probe-barrel-contacts.mjs): 705 contacts, 635 reactions. One
 * touch in ten bounced the duck off a crate that did not move a muscle — a slam
 * at 1880 px/s among them, silent only because another duck had hit the same
 * crate a tenth of a second earlier.
 *
 * Both gates are gone now (see collideDuckBarrels): every contact costs a
 * stage, so on an ordinary hit the two events fire together. They stay separate
 * questions all the same — `barrelBumped` answers "was it touched",
 * `barrelDamaged` "what is it wearing now" — and only the second one is
 * meaningful for a blast, which damages a crate without touching it.
 */
describe('barrelBumped', () => {
  it('a soft drift reports the contact, and now costs a stage with it', () => {
    const w = mk();
    const barrel = w.spawnBarrel('wood', 420, 700, 2);
    const d = w.spawnDuck('red', 320, 700);
    d.vx = 60; // a soft drift, never launched
    for (let i = 0; i < 120; i++) w.step(SIM.DT);
    expect(barrel.hp).toBe(1);
    expect(w.events.filter((e) => e.type === 'barrelBumped').length).toBeGreaterThan(0);
    expect(w.events.filter((e) => e.type === 'barrelDamaged')).toHaveLength(1);
  });

  it('a hard hit reports the contact AND the stage, exactly one of each', () => {
    const w = mk();
    const barrel = w.spawnBarrel('wood', 500, 700, 3);
    const d = w.spawnDuck('red', 300, 700);
    w.launch(d.id, 1000, 0);
    for (let i = 0; i < 30; i++) w.step(SIM.DT);
    expect(barrel.hp).toBe(2);
    expect(w.events.filter((e) => e.type === 'barrelBumped')).toHaveLength(1);
    expect(w.events.filter((e) => e.type === 'barrelDamaged')).toHaveLength(1);
    // the flinch is reported before the stage it caused
    const bump = w.events.findIndex((e) => e.type === 'barrelBumped');
    const dmg = w.events.findIndex((e) => e.type === 'barrelDamaged');
    expect(bump).toBeLessThan(dmg);
  });

  it('a second duck arriving at once gets its own flinch AND its own stage', () => {
    // The loudest case in the measurement: 25 of the 70 silent contacts were
    // fast enough to damage and were refused only by the cooldown a moment
    // earlier. The debounce is per DUCK now — it exists to stop one physical
    // collision counting twice across substeps, never to swallow a second
    // duck's separate hit.
    const w = mk();
    const barrel = w.spawnBarrel('wood', 360, 700, 3);
    const gap = SIM.DUCK_R + SIM.BARREL_R + 8; // one step short of touching
    const left = w.spawnDuck('red', 360 - gap, 700);
    const right = w.spawnDuck('green', 360 + gap, 700);
    left.vx = 600; // both arriving on the same step
    right.vx = -600;
    // 4 steps: long enough for both contacts, short enough that the half-energy
    // rebound cannot reach a wall and come back for a second, real collision.
    for (let i = 0; i < 4; i++) w.step(SIM.DT);
    expect(w.events.filter((e) => e.type === 'barrelBumped')).toHaveLength(2);
    expect(w.events.filter((e) => e.type === 'barrelDamaged')).toHaveLength(2);
    expect(barrel.hp).toBe(1); // two ducks, two stages
  });

  it('carries the contact point and the PRE-bounce approach speed', () => {
    const w = mk();
    w.spawnBarrel('wood', 500, 700, 3);
    const d = w.spawnDuck('red', 300, 700);
    w.launch(d.id, 1000, 0);
    for (let i = 0; i < 30; i++) w.step(SIM.DT);
    const e = w.events.find((k) => k.type === 'barrelBumped');
    expect(e).toBeDefined();
    // contact point is the duck's centre, snapped to exactly touching
    expect(Math.hypot(e!.x - 500, e!.y - 700)).toBeCloseTo(SIM.DUCK_R + SIM.BARREL_R, 3);
    // approach, not the RESTITUTION_STATIC exit (which is half of it)
    expect(e!.speed).toBeGreaterThan(900);
    expect(e!.speed).toBeLessThanOrEqual(1000);
  });

  it('one physical collision is ONE flinch, not one per substep', () => {
    // The no-cooldown claim, same as duckBumped's. The resolver snaps the duck
    // out to exactly touching and reflects it, so the next substep finds them
    // apart and cannot re-fire. Without that this would be ~960 events/second
    // for as long as a duck rested against a crate.
    const w = mk();
    w.spawnBarrel('wood', 420, 700, 9);
    const d = w.spawnDuck('red', 420 - (SIM.DUCK_R + SIM.BARREL_R) + 2, 700); // already overlapping
    for (let i = 0; i < 120; i++) w.step(SIM.DT);
    expect(w.events.filter((e) => e.type === 'barrelBumped').length).toBeLessThanOrEqual(1);
  });

  it('a blast that chips a crate reports no contact — nothing touched it', () => {
    const w = mk();
    const barrel = w.spawnBarrel('wood', 360, 815, 3); // 115 < BLAST_R
    w.popDuck(w.spawnDuck('yellow', 360, 700));
    expect(barrel.hp).toBe(2);
    expect(w.events.filter((e) => e.type === 'barrelBumped')).toHaveLength(0);
  });
});

/**
 * duck-duck contact was the only collision routine in world.ts that reported
 * nothing, which is why the game's most common interaction had no sound and no
 * spray. These pin the event's shape and — the load-bearing one — the claim that
 * it needs no cooldown state.
 */
describe('duckBumped', () => {
  it('a different-colour bounce reports a bump and no match', () => {
    const w = mk();
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('green', 460, 700);
    w.launch(a.id, 900, 0);
    for (let i = 0; i < 30; i++) w.step(SIM.DT);
    expect(w.events.filter((e) => e.type === 'duckBumped').length).toBeGreaterThan(0);
    expect(w.events.filter((e) => e.type === 'duckMatched')).toHaveLength(0);
  });

  it('on a same-colour hit the bump lands BEFORE the match', () => {
    const w = mk();
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('red', 460, 700);
    w.launch(a.id, 1600, 0);
    for (let i = 0; i < 30; i++) w.step(SIM.DT);
    const bump = w.events.findIndex((e) => e.type === 'duckBumped');
    const match = w.events.findIndex((e) => e.type === 'duckMatched');
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(match).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThan(match);
  });

  it('reports the PRE-impulse approach speed, not the post-bounce one', () => {
    const w = mk();
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('green', 393, 700); // one step from touching at 92px apart
    a.vx = 900;
    a.live = true;
    w.step(SIM.DT);
    const e = w.events.find((k) => k.type === 'duckBumped');
    expect(e).toBeDefined();
    // drag shaves a little off 900 before the substeps run; the point is that it
    // is the approach speed and nowhere near the RESTITUTION_BODY exit
    expect(e!.speed).toBeGreaterThan(850);
    expect(e!.speed).toBeLessThanOrEqual(900);
  });

  it('a settled cluster in mutual contact emits NOTHING across 120 steps', () => {
    // The whole no-cooldown argument: the impulse only runs on rel < 0 and
    // leaves the pair separating, so one physical collision cannot re-fire
    // across the 2-16 adaptive substeps. Without that this would be roughly
    // 960 events/second per touching pair.
    const w = mk();
    const r = SIM.DUCK_R * 2 - 2; // deliberately overlapping, as a real cluster is
    w.spawnDuck('red', 360, 700);
    w.spawnDuck('green', 360 + r, 700);
    w.spawnDuck('purple', 360 + r / 2, 700 + r * 0.87);
    w.spawnDuck('yellow', 360 - r / 2, 700 + r * 0.87);
    for (let i = 0; i < 120; i++) w.step(SIM.DT);
    expect(w.events.filter((e) => e.type === 'duckBumped')).toHaveLength(0);
  });

  it('is deterministic: the same seed gives the same bump sequence', () => {
    const run = (): string => {
      const w = new World(7);
      const a = w.spawnDuck('red', 300, 700);
      w.spawnDuck('green', 470, 660);
      w.spawnDuck('purple', 520, 780);
      w.launch(a.id, 1400, 120);
      for (let i = 0; i < 180; i++) w.step(SIM.DT);
      return w.events
        .filter((e) => e.type === 'duckBumped')
        .map((e) => `${e.a}-${e.b}@${e.speed.toFixed(6)}`)
        .join('|');
    };
    const first = run();
    expect(first.length).toBeGreaterThan(0);
    expect(run()).toBe(first);
  });
});

describe('spawn protection', () => {
  it('a blast neither dooms nor shoves a duck inside its spawn shield', () => {
    const w = mk();
    const d = w.spawnDuck('red', 360, 700);
    w.blast('green', 420, 700); // 60px away — deep inside BLAST_R
    expect(d.matched).toBe(false);
    expect(d.popOnSettle).toBe(false);
    expect(d.vx).toBe(0);
    expect(d.vy).toBe(0);
  });

  it('the shield expires on its own clock and the duck is ordinary again', () => {
    const w = mk();
    const d = w.spawnDuck('red', 360, 700);
    for (let i = 0; i < SIM.SPAWN_SHIELD_TICKS; i++) w.step(SIM.DT);
    w.blast('green', 420, 700);
    expect(d.matched).toBe(true);
    expect(d.popOnSettle).toBe(true);
  });

  it('launching sheds the shield: a fired duck is fully active at once', () => {
    const w = mk();
    const d = w.spawnDuck('red', 360, 700);
    w.launch(d.id, 800, 0);
    expect(d.spawnShieldTicks).toBe(0);
  });

  it('a doomed duck cannot recruit a shielded one by ramming it', () => {
    const w = mk();
    const fresh = w.spawnDuck('red', 400, 700);
    const doomed = w.spawnDuck('red', 280, 700);
    doomed.matched = true; // mid-chain: fuse lit, drifting toward the arrival
    doomed.matchFuse = 100000;
    doomed.vx = 900;
    doomed.live = true;
    for (let i = 0; i < 12; i++) w.step(SIM.DT); // well inside the shield window
    expect(fresh.matched).toBe(false);
    expect(fresh.popOnSettle).toBe(false);
  });

  it('a CLEAN same-colour hit still matches inside the window — only explosions in progress are shut out', () => {
    const w = mk();
    const fresh = w.spawnDuck('red', 460, 700);
    const shot = w.spawnDuck('red', 300, 700);
    w.launch(shot.id, 900, 0);
    for (let i = 0; i < 12; i++) w.step(SIM.DT);
    expect(fresh.matched).toBe(true);
    expect(shot.matched).toBe(true);
  });
});
