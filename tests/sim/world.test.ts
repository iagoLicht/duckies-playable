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

  it('a slow drifting duck does NOT damage a barrel', () => {
    const w = mk();
    const barrel = w.spawnBarrel('wood', 420, 700, 2);
    const d = w.spawnDuck('red', 320, 700);
    d.vx = 60; // below BARREL_HIT_SPEED, not launched
    for (let i = 0; i < 120; i++) w.step(SIM.DT);
    expect(barrel.hp).toBe(2);
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
