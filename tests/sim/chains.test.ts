import { describe, expect, it } from 'vitest';
import { SIM } from '../../src/sim/config';
import { World } from '../../src/sim/world';

const settle = (w: World, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds * 60); i++) w.step(SIM.DT);
};

describe('same-colour pops and chain blasts', () => {
  it('two same-colour ducks colliding at speed both pop and emit a blast', () => {
    const w = new World(1);
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('red', 460, 700);
    w.launch(a.id, 900, 0);
    settle(w, 1.5);
    expect(w.ducks).toHaveLength(0);
    const pops = w.events.filter((e) => e.type === 'duckPopped');
    expect(pops).toHaveLength(2);
    expect(w.events.some((e) => e.type === 'blast' && e.colour === 'red')).toBe(true);
  });

  it('different colours never pop', () => {
    const w = new World(1);
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('green', 460, 700);
    w.launch(a.id, 900, 0);
    settle(w, 2);
    expect(w.ducks).toHaveLength(2);
  });

  it('blast chains through same-colour ducks only', () => {
    const w = new World(1);
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('red', 440, 700);
    // third red inside blast radius of the pair's midpoint
    w.spawnDuck('red', 480, 800);
    // green nearby must survive
    const green = w.spawnDuck('green', 350, 810);
    w.launch(a.id, 900, 0);
    settle(w, 2);
    expect(w.ducks).toHaveLength(1);
    expect(w.ducks[0]!.id).toBe(green.id);
    expect(w.events.filter((e) => e.type === 'blast').length).toBeGreaterThanOrEqual(2);
  });

  it('blasts damage barrels of any colour in radius', () => {
    const w = new World(1);
    const barrel = w.spawnBarrel('purple', 380, 810, 3);
    const a = w.spawnDuck('red', 300, 700);
    w.spawnDuck('red', 460, 700);
    w.launch(a.id, 900, 0);
    settle(w, 1.5);
    expect(barrel.hp).toBe(1);
  });

  it('a stationary pair does not spontaneously pop', () => {
    const w = new World(1);
    w.spawnDuck('red', 300, 700);
    w.spawnDuck('red', 300 + SIM.DUCK_R * 2 + 1, 700);
    settle(w, 2);
    expect(w.ducks).toHaveLength(2);
  });
});
