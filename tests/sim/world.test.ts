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

  it('duck hitting a barrel bounces back and damages it', () => {
    const w = mk();
    const barrel = w.spawnBarrel('wood', 500, 700, 2);
    const d = w.spawnDuck('red', 300, 700);
    w.launch(d.id, 1000, 0);
    for (let i = 0; i < 90; i++) w.step(SIM.DT);
    expect(barrel.hp).toBe(1);
    expect(d.x).toBeLessThan(500 - 46); // did not tunnel through
    const evs = w.events.filter((e) => e.type === 'barrelDamaged');
    expect(evs).toHaveLength(1);
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
